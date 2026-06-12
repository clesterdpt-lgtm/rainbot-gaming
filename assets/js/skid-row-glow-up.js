/* ============================================================
   Skid Row Glow-Up: Clout Couture
   Makeover / influencer parody for Rainbot Gaming.
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "skid-row-glow-up";
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const POSTS_TO_END = 6;
  const STYLE_WIN = 88;
  const RESPECT_MIN = 24;
  const ASSET_VERSION = "20260612-4";

  const $ = (id) => document.getElementById(id);
  const el = {
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlaySub: $("overlay-sub"),
    overlayScore: $("overlay-score"),
    primary: $("btn-primary"),
    male: $("btn-male"),
    female: $("btn-female"),
    sideMale: $("btn-side-male"),
    sideFemale: $("btn-side-female"),
    pause: $("btn-pause"),
    restart: $("btn-restart"),
    actions: $("glowup-actions"),
    feed: $("social-feed"),
    postMobile: $("btn-post-mobile"),
    hudGuest: $("hud-guest"),
    hudStyle: $("hud-style"),
    hudRespect: $("hud-respect"),
    hudLikes: $("hud-likes"),
    hudPosts: $("hud-posts"),
    hudHigh: $("hud-high"),
  };

  const api = window.RB || {
    toast: () => {},
    recordScore: () => false,
    getHighScore: () => 0,
  };

  const assetPaths = {
    background: `../assets/img/skid-row-glow-up/street-background.png?v=${ASSET_VERSION}`,
    blackMale: `../assets/img/skid-row-glow-up/black-man.png?v=${ASSET_VERSION}`,
    whiteWoman: `../assets/img/skid-row-glow-up/white-woman.png?v=${ASSET_VERSION}`,
  };

  const art = {};

  const options = {
    male: {
      names: ["Marcus", "Dre", "Leon", "Terry"],
      hair: ["beanie", "clean fade", "textured curls", "silver sweep"],
      makeup: ["none", "camera concealer", "neon liner", "glow balm"],
      outfit: ["worn hoodie", "fresh hoodie", "thrift blazer", "velvet jacket"],
    },
    female: {
      names: ["Marlene", "Diane", "Rita", "Linda"],
      hair: ["beanie", "messy bob", "silver shag", "high pony"],
      makeup: ["none", "camera concealer", "neon liner", "full glam"],
      outfit: ["worn hoodie", "fresh hoodie", "thrift blazer", "star jacket"],
    },
    accessory: ["none", "shades", "silver chain", "silk scarf", "vape"],
    backdrop: ["sidewalk set", "ring light", "thrift backdrop", "neon mural"],
  };

  const actionDefs = [
    { id: "consent", label: "Ask First", detail: "+Respect", good: true, effect: () => applyMove({ respect: 12, hype: 4, likes: 450, comment: ["Pinned", "Consent check passed. Comments slightly less radioactive."] }) },
    { id: "hair", label: "Haircut", detail: "+Style", good: true, effect: () => cycleLook("hair", { style: 13, hype: 5, respect: 3, likes: 1100 }) },
    { id: "makeup", label: "Makeup", detail: "+Glow", good: true, effect: () => cycleLook("makeup", { style: 12, hype: 7, respect: 2, likes: 1250 }) },
    { id: "outfit", label: "Outfit Swap", detail: "+Style", good: true, effect: () => cycleLook("outfit", { style: 15, hype: 6, respect: 5, likes: 1450 }) },
    { id: "accessory", label: "Accessory", detail: "shades/chain/scarf/vape", good: true, effect: () => cycleLook("accessory", { style: 8, hype: 8, respect: -1, likes: 1650 }) },
    { id: "backdrop", label: "Backdrop", detail: "+Production", good: true, effect: () => cycleLook("backdrop", { style: 7, hype: 12, respect: 0, likes: 2100 }) },
    { id: "meal", label: "Buy Lunch", detail: "+Respect", good: true, effect: () => applyMove({ respect: 16, style: 4, hype: 2, likes: 900, comment: ["Local", "This part is actually wholesome. More of this, please."] }) },
    { id: "vape", label: "Vape Cameo", detail: "funny risky prop", effect: () => setAccessory("vape", { style: 5, hype: 16, respect: -5, likes: 3300, comment: ["Top comment", "The vape cloud entering frame like paid talent is insane."] }) },
    { id: "caption", label: "Clickbait Caption", detail: "+Likes -Respect", effect: () => applyMove({ respect: -14, hype: 18, likes: 7200, comment: ["Comment storm", "The caption is doing too much. The replies have formed a committee."] }) },
    { id: "post", label: "Post Reel", detail: "convert hype", good: true, effect: () => postReel() },
  ];

  const randomComments = [
    ["@auntie_wifi", "Fit check went unexpectedly hard."],
    ["@ringlightlawyer", "This is either wholesome or a deposition exhibit."],
    ["@streetstyle_savant", "The thrift blazer is carrying the whole timeline."],
    ["@mutualaid_mike", "Likes are cool. Resources are cooler."],
    ["@vapeweather", "Cloud density: cinematic."],
    ["@commentsection911", "The comments have discovered nuance and hate it."],
    ["@algo_blessed", "The algorithm just blinked twice."],
    ["@budgetbalenci", "Knockoff shades, authentic confidence."],
  ];

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    gender: "male",
    name: "Marcus",
    style: 10,
    respect: 80,
    hype: 10,
    likes: 0,
    posts: 0,
    combo: 0,
    high: 0,
    look: {
      hair: 0,
      makeup: 0,
      outfit: 0,
      accessory: 0,
      backdrop: 0,
    },
    selectedMove: null,
    lastComment: ["Producer", "Pick a participant and build the look."],
    feed: [
      ["Producer", "Pick a participant and build the look."],
      ["Ethics intern", "Ask first. Seriously."],
      ["Algorithm", "Waiting for spectacle."],
    ],
    particles: [],
    floats: [],
    flash: 0,
    shake: 0,
    pulse: 0,
    reelTimer: 0,
    messageTimer: 0,
    lastTime: 0,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const postButtonRect = () => ({ x: W - 216, y: H - 76, w: 168, h: 52 });
  const moneyLikes = (value) => {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + "M";
    if (value >= 1000) return (value / 1000).toFixed(1).replace(".0", "") + "K";
    return Math.round(value).toString();
  };
  const imageReady = (img) => img && img.complete && img.naturalWidth > 0;

  function loadArt() {
    Object.entries(assetPaths).forEach(([key, src]) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => draw();
      img.onerror = () => {
        // The canvas has vector fallbacks, so a missed image should not stop play.
      };
      img.src = src;
      art[key] = img;
    });
  }

  function reset(preserveGender = true) {
    const gender = preserveGender ? state.gender : "male";
    const name = pick(options[gender].names);
    Object.assign(state, {
      running: false,
      paused: false,
      gameOver: false,
      gender,
      name,
      style: 10,
      respect: 80,
      hype: 10,
      likes: 0,
      posts: 0,
      combo: 0,
      high: api.getHighScore(GAME_ID),
      look: { hair: 0, makeup: 0, outfit: 0, accessory: 0, backdrop: 0 },
      selectedMove: null,
      lastComment: ["Producer", "Pick a participant and build the look."],
      feed: [
        ["Producer", "Pick a participant and build the look."],
        ["Ethics intern", "Ask first. Seriously."],
        ["Algorithm", "Waiting for spectacle."],
      ],
      particles: [],
      floats: [],
      flash: 0,
      shake: 0,
      pulse: 0,
      reelTimer: 0,
      messageTimer: 0,
      lastTime: 0,
    });
    updateGenderButtons();
    updateHUD();
    renderFeed();
    draw();
  }

  function chooseGender(gender) {
    state.gender = gender;
    state.name = pick(options[gender].names);
    state.look = { hair: 0, makeup: 0, outfit: 0, accessory: 0, backdrop: 0 };
    state.lastComment = ["Casting", `${state.name} is ready for the makeover.`];
    state.feed = [
      ["Casting", `${state.name} joined the shoot.`],
      ["Ethics intern", "Consent forms are hotter than clickbait."],
      ["Algorithm", "New face detected. Be normal about it."],
    ];
    updateGenderButtons();
    updateHUD();
    renderFeed();
    draw();
  }

  function startGame() {
    if (state.running && !state.gameOver) return;
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.lastTime = performance.now();
    hideOverlay();
    if (!state.name) chooseGender(state.gender);
    addFeed("Director", "Shoot is live. Try for viral without becoming a cautionary tale.");
    requestAnimationFrame(loop);
    canvas.focus();
  }

  function showOverlay(title, sub, buttonText, scoreHtml = "") {
    el.overlayTitle.textContent = title;
    el.overlaySub.innerHTML = sub;
    el.overlayScore.style.display = scoreHtml ? "block" : "none";
    el.overlayScore.innerHTML = scoreHtml;
    el.primary.textContent = buttonText;
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    el.overlay.classList.remove("overlay--show");
  }

  function loop(now) {
    if (!state.running) return;
    const dt = Math.min(0.05, Math.max(0, (now - (state.lastTime || now)) / 1000));
    state.lastTime = now;
    if (!state.paused && !state.gameOver) update(dt);
    draw();
    if (state.running) requestAnimationFrame(loop);
  }

  function update(dt) {
    state.pulse = Math.max(0, state.pulse - dt * 3.8);
    state.flash = Math.max(0, state.flash - dt * 2.8);
    state.shake = Math.max(0, state.shake - dt * 4);
    state.reelTimer = Math.max(0, state.reelTimer - dt);
    state.messageTimer = Math.max(0, state.messageTimer - dt);
    state.hype = clamp(state.hype - dt * 0.9, 0, 100);

    if (state.respect <= 0) {
      endGame("COMMENT SECTION MUTINY", "The audience decided this was content malpractice.");
      return;
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        state.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 90 * dt;
    }

    for (let i = state.floats.length - 1; i >= 0; i--) {
      const f = state.floats[i];
      f.age += dt;
      if (f.age >= f.life) {
        state.floats.splice(i, 1);
        continue;
      }
      f.y -= 24 * dt;
    }
  }

  function applyMove(delta) {
    if (!canAct()) return;
    state.style = clamp(state.style + (delta.style || 0), 0, 100);
    state.respect = clamp(state.respect + (delta.respect || 0), 0, 100);
    state.hype = clamp(state.hype + (delta.hype || 0), 0, 100);
    addLikes(delta.likes || 0);
    state.combo += 1;
    state.pulse = 1;
    state.flash = delta.respect && delta.respect < 0 ? 0.42 : 0.25;
    state.shake = delta.respect && delta.respect < 0 ? 0.28 : 0.08;
    if (delta.comment) addFeed(delta.comment[0], delta.comment[1]);
    else addFeed(...pick(randomComments));
    spawnBurst(W / 2, 270, delta.respect && delta.respect < 0 ? "#ff5c5c" : "#ffd43b", 18);
    maybeRandomReaction();
    updateHUD();
  }

  function cycleLook(key, delta) {
    if (!canAct()) return;
    if (key === "accessory" || key === "backdrop") {
      state.look[key] = (state.look[key] + 1) % options[key].length;
    } else {
      state.look[key] = (state.look[key] + 1) % options[state.gender][key].length;
    }
    const label = getLookLabel(key);
    applyMove({
      ...delta,
      comment: ["Stylist", `${key.toUpperCase()} updated: ${label}. The camera pretended it planned this.`],
    });
  }

  function setAccessory(label, delta) {
    if (!canAct()) return;
    state.look.accessory = options.accessory.indexOf(label);
    applyMove(delta);
  }

  function postReel() {
    if (!canAct()) return;
    const base = 2200 + state.style * 94 + state.hype * 132 + state.respect * 28;
    const respectMultiplier = state.respect < 25 ? 0.58 : state.respect > 72 ? 1.2 : 1;
    const styleMultiplier = 0.8 + state.style / 100;
    const comboMultiplier = 1 + Math.min(0.42, state.combo * 0.035);
    const gain = Math.round(base * respectMultiplier * styleMultiplier * comboMultiplier);
    state.posts += 1;
    state.hype = clamp(state.hype + 8, 0, 100);
    state.respect = clamp(state.respect - (state.respect < 34 ? 4 : 1), 0, 100);
    state.reelTimer = 1.4;
    state.pulse = 1;
    addLikes(gain);
    addFeed("Fresh post", `Reel ${state.posts}/${POSTS_TO_END}: +${moneyLikes(gain)} likes. ${postVerdict()}`);
    spawnBurst(W / 2, 250, "#2ee0ff", 34);
    updateHUD();

    if (state.respect < RESPECT_MIN) {
      endGame("CALLED OUT ARC", "The likes arrived, but so did the stitch videos.");
      return;
    }

    if (state.posts >= POSTS_TO_END) {
      const won = state.style >= STYLE_WIN && state.respect >= 45;
      endGame(
        won ? "VIRAL WITHOUT BEING AWFUL" : "MID BUT MONETIZED",
        won
          ? "The look landed, the comments stayed mostly human, and the algorithm gave a polite little bow."
          : "You posted the series, but the glow-up needed more style or more basic decency.",
        won
      );
    }
  }

  function endGame(title, sub, won = false) {
    state.gameOver = true;
    state.running = false;
    const finalScore = Math.round(state.likes + state.style * 420 + state.respect * 800 + state.posts * 1500);
    const isHigh = api.recordScore(GAME_ID, finalScore);
    const high = api.getHighScore(GAME_ID);
    updateHUD();
    showOverlay(
      won ? "✨ " + title : title,
      sub,
      "Run it back",
      `Score: <strong>${finalScore.toLocaleString()}</strong> · Likes: <strong>${moneyLikes(state.likes)}</strong> · Respect: <strong>${Math.round(state.respect)}</strong> · ${isHigh ? "<strong>New high score</strong>" : "High: <strong>" + high.toLocaleString() + "</strong>"}`
    );
  }

  function canAct() {
    return state.running && !state.paused && !state.gameOver;
  }

  function addLikes(amount) {
    const bonus = Math.max(0, Math.round(amount * (state.combo * 0.03)));
    const total = Math.round(amount + bonus);
    state.likes += total;
    if (total > 0) {
      state.floats.push({ text: `+${moneyLikes(total)} likes`, x: W / 2 + 106, y: 102, age: 0, life: 1.2, color: "#6bff7d" });
    }
  }

  function maybeRandomReaction() {
    if (Math.random() > 0.28) return;
    const bad = state.respect < 38 && Math.random() > 0.36;
    if (bad) {
      state.respect = clamp(state.respect - 6, 0, 100);
      state.hype = clamp(state.hype + 5, 0, 100);
      addFeed("Stitch video", "Someone asks whether the camera did more work than the kindness.");
      state.floats.push({ text: "-Respect", x: 170, y: 114, age: 0, life: 1.2, color: "#ff5c5c" });
    } else {
      const comment = pick(randomComments);
      addFeed(comment[0], comment[1]);
    }
  }

  function postVerdict() {
    if (state.respect > 74) return "Rare wholesome internet moment.";
    if (state.respect < 34) return "The quote-posts are circling.";
    if (state.style > 80) return "Fit is doing numbers.";
    return "Algorithm is interested, but emotionally distant.";
  }

  function getLookLabel(key) {
    if (key === "accessory" || key === "backdrop") return options[key][state.look[key]];
    return options[state.gender][key][state.look[key]];
  }

  function addFeed(author, text) {
    state.lastComment = [author, text];
    state.feed.unshift([author, text]);
    state.feed = state.feed.slice(0, 4);
    renderFeed();
  }

  function renderActions() {
    el.actions.innerHTML = "";
    actionDefs.forEach((action, index) => {
      const btn = document.createElement("button");
      btn.className = `btn ${action.good ? "btn--secondary" : "btn--ghost"} glowup-action`;
      if (action.id === "post") btn.className = "btn btn--primary glowup-action";
      btn.type = "button";
      btn.innerHTML = `${index + 1}. ${action.label}<small>${action.detail}</small>`;
      btn.addEventListener("click", action.effect);
      el.actions.appendChild(btn);
    });
  }

  function renderFeed() {
    el.feed.innerHTML = state.feed
      .map(([author, text]) => `<div class="glowup-comment"><strong>${escapeHtml(author)}</strong>${escapeHtml(text)}</div>`)
      .join("");
  }

  function updateHUD() {
    el.hudGuest.textContent = state.name || "Pick";
    el.hudStyle.textContent = Math.round(state.style);
    el.hudRespect.textContent = Math.round(state.respect);
    el.hudLikes.textContent = moneyLikes(state.likes);
    el.hudPosts.textContent = `${state.posts}/${POSTS_TO_END}`;
    el.hudHigh.textContent = api.getHighScore(GAME_ID).toLocaleString();
    el.hudStyle.style.color = state.style > 74 ? "var(--good)" : "var(--accent-3)";
    el.hudRespect.style.color = state.respect < 34 ? "var(--bad)" : "var(--accent-2)";
  }

  function updateGenderButtons() {
    [el.male, el.sideMale].forEach((button) => button.classList.toggle("btn--primary", state.gender === "male"));
    [el.female, el.sideFemale].forEach((button) => button.classList.toggle("btn--primary", state.gender === "female"));
  }

  function togglePause() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    el.pause.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) showOverlay("SHOOT PAUSED", "The ring light is cooling down and the comments are unsupervised.", "Resume");
    else {
      hideOverlay();
      state.lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function draw() {
    const time = performance.now() / 1000;
    const sx = (Math.random() - 0.5) * state.shake * 8;
    const sy = (Math.random() - 0.5) * state.shake * 8;
    ctx.save();
    ctx.translate(sx, sy);
    drawBackdrop(time);
    drawReelFrame(time);
    drawCharacter(360, 506, time);
    drawSocialPanel(time);
    drawLowerBar(time);
    drawParticles();
    drawFlash();
    if (state.paused) drawPause();
    ctx.restore();
  }

  function drawBackdrop(time) {
    const backdrop = getLookLabel("backdrop");
    if (imageReady(art.background)) {
      drawCoverImage(art.background, 0, 0, W, H);
      drawBackgroundGrade(backdrop, time);
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, backdrop === "neon mural" ? "#1b1037" : "#10151e");
      bg.addColorStop(0.45, "#1a1420");
      bg.addColorStop(1, "#05070d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(358, 190, 30, 358, 190, 460);
      glow.addColorStop(0, `rgba(255, 46, 136, ${0.22 + state.pulse * 0.18})`);
      glow.addColorStop(0.5, "rgba(46, 224, 255, 0.08)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      drawSkidRowStreet(time);
      drawStudioGear(time);
    }

    if (backdrop === "thrift backdrop" || backdrop === "neon mural") {
      ctx.fillStyle = backdrop === "neon mural" ? "rgba(255,46,136,0.26)" : "rgba(255,212,59,0.18)";
      roundRect(190, 70, 350, 270, 18);
      ctx.fill();
      ctx.strokeStyle = backdrop === "neon mural" ? "#ff2e88" : "#ffd43b";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.font = "bold 22px Bungee, Impact, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(backdrop === "neon mural" ? "GLOW" : "THRIFT", 365, 136);
      ctx.font = "bold 11px JetBrains Mono, monospace";
      ctx.fillText("COUTURE POP-UP", 365, 159);
    }
  }

  function drawCoverImage(img, x, y, w, h) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = (img.naturalHeight - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function drawBackgroundGrade(backdrop, time) {
    const tint = {
      "sidewalk set": "rgba(4,7,14,0.12)",
      "ring light": "rgba(255,212,59,0.08)",
      "thrift backdrop": "rgba(46,224,255,0.08)",
      "neon mural": "rgba(255,46,136,0.12)",
    }[backdrop] || "rgba(4,7,14,0.12)";

    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);

    const centerGlow = ctx.createRadialGradient(356, 230, 35, 356, 230, 360);
    centerGlow.addColorStop(0, `rgba(255,255,255,${0.08 + state.pulse * 0.08})`);
    centerGlow.addColorStop(0.36, `rgba(255,46,136,${0.10 + state.style / 1400})`);
    centerGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, W, H);

    const vignette = ctx.createRadialGradient(W / 2, H / 2, 160, W / 2, H / 2, 620);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.68, "rgba(0,0,0,0.16)");
    vignette.addColorStop(1, "rgba(0,0,0,0.58)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = `rgba(255,255,255,${0.08 + Math.sin(time * 2) * 0.02})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 374);
    ctx.lineTo(W, 374);
    ctx.stroke();
  }

  function drawSkidRowStreet(time) {
    drawStorefronts(time);
    drawStreetProps(time);
    drawStreetFloor(time);
    drawUtilityLines(time);
  }

  function drawStorefronts(time) {
    const facades = [
      { x: -36, w: 132, h: 188, color: "#191b24", sign: "6TH ST", accent: "#ffd43b" },
      { x: 96, w: 124, h: 210, color: "#141a23", sign: "MISSION", accent: "#2ee0ff" },
      { x: 220, w: 160, h: 198, color: "#1c1724", sign: "ROW MARKET", accent: "#ff2e88" },
      { x: 380, w: 116, h: 214, color: "#171a22", sign: "HOTEL", accent: "#ffd43b" },
      { x: 496, w: 150, h: 190, color: "#171522", sign: "DONUTS", accent: "#2ee0ff" },
      { x: 646, w: 150, h: 205, color: "#151922", sign: "WAREHOUSE", accent: "#ff2e88" },
      { x: 796, w: 128, h: 184, color: "#1a1720", sign: "CROCKER", accent: "#ffd43b" },
    ];

    facades.forEach((shop, i) => {
      const top = 104 + (i % 2) * 10;
      ctx.fillStyle = shop.color;
      roundRect(shop.x, top, shop.w, shop.h, 3);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let y = top + 12; y < top + shop.h - 16; y += 22) {
        ctx.fillRect(shop.x + 8, y, shop.w - 16, 2);
      }

      ctx.fillStyle = "rgba(0,0,0,0.56)";
      roundRect(shop.x + 8, top + 38, shop.w - 16, shop.h - 60, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      for (let y = top + 50; y < top + shop.h - 30; y += 13) {
        ctx.beginPath();
        ctx.moveTo(shop.x + 12, y);
        ctx.lineTo(shop.x + shop.w - 12, y);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(0,0,0,0.66)";
      roundRect(shop.x + 8, top + 8, shop.w - 16, 26, 5);
      ctx.fill();
      ctx.strokeStyle = shop.accent;
      ctx.globalAlpha = 0.58 + Math.sin(time * 1.5 + i) * 0.08;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = shop.accent;
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(shop.sign, shop.x + shop.w / 2, top + 26);
    });

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 14; i++) {
      ctx.fillRect((i * 82 + time * 8) % (W + 80) - 40, 52 + (i % 5) * 28, 42, 2);
    }
  }

  function drawStreetProps(time) {
    drawTarps();
    drawBoxesAndCones(time);

    ctx.fillStyle = "rgba(0,0,0,0.58)";
    roundRect(22, 282, 104, 38, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,212,59,0.38)";
    ctx.stroke();
    ctx.fillStyle = "#ffd43b";
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("SAN JULIAN", 74, 305);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(760, 258, 94, 42, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(46,224,255,0.34)";
    ctx.stroke();
    ctx.fillStyle = "#2ee0ff";
    ctx.fillText("LOS ANGELES", 807, 282);
  }

  function drawTarps() {
    const tarps = [
      { x: 28, y: 324, w: 128, h: 58, color: "#173b4a", line: "#2ee0ff" },
      { x: 738, y: 318, w: 136, h: 62, color: "#4c2940", line: "#ff2e88" },
      { x: 566, y: 306, w: 86, h: 44, color: "#4b3b15", line: "#ffd43b" },
    ];
    tarps.forEach((tarp) => {
      const grad = ctx.createLinearGradient(tarp.x, tarp.y, tarp.x, tarp.y + tarp.h);
      grad.addColorStop(0, lighten(tarp.color, 12));
      grad.addColorStop(1, darken(tarp.color, 14));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(tarp.x, tarp.y + tarp.h);
      ctx.lineTo(tarp.x + tarp.w * 0.22, tarp.y + 8);
      ctx.lineTo(tarp.x + tarp.w * 0.82, tarp.y + 4);
      ctx.lineTo(tarp.x + tarp.w, tarp.y + tarp.h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = tarp.line;
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(tarp.x + i * (tarp.w / 4), tarp.y + 14);
        ctx.lineTo(tarp.x + i * (tarp.w / 4) + 8, tarp.y + tarp.h - 8);
        ctx.stroke();
      }
    });
  }

  function drawBoxesAndCones(time) {
    const boxes = [
      [148, 354, 42, 34], [186, 366, 34, 22], [700, 350, 44, 32], [652, 366, 34, 24],
    ];
    boxes.forEach(([x, y, w, h], i) => {
      ctx.fillStyle = i % 2 ? "#8b5a32" : "#6f4529";
      roundRect(x, y, w, h, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.34)";
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,212,59,0.16)";
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 10);
      ctx.lineTo(x + w - 8, y + 7);
      ctx.stroke();
    });

    [232, 678, 824].forEach((x, i) => {
      const y = 358 + (i % 2) * 8;
      ctx.fillStyle = "#ff7a1a";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 13, y + 42);
      ctx.lineTo(x + 13, y + 42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.fillRect(x - 8, y + 17, 16, 5);
    });

    ctx.strokeStyle = `rgba(255,255,255,${0.10 + Math.sin(time * 2) * 0.03})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(70, 332);
    ctx.lineTo(144, 380);
    ctx.moveTo(800, 328);
    ctx.lineTo(728, 378);
    ctx.stroke();
  }

  function drawStreetFloor(time) {
    const street = ctx.createLinearGradient(0, 350, 0, H);
    street.addColorStop(0, "#22232b");
    street.addColorStop(0.55, "#12141c");
    street.addColorStop(1, "#070911");
    ctx.fillStyle = street;
    ctx.fillRect(0, 350, W, H - 350);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 374);
    ctx.lineTo(W, 374);
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = "#2ee0ff";
    ctx.lineWidth = 1;
    for (let y = 390; y < H; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + (y - 390) * 0.08);
      ctx.stroke();
    }
    for (let x = -180; x < W + 180; x += 52) {
      ctx.beginPath();
      ctx.moveTo(364, 370);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(255,212,59,0.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const y = 414 + i * 18;
      ctx.beginPath();
      ctx.moveTo(34 + i * 7, y);
      ctx.quadraticCurveTo(70 + i * 3, y + 5, 118 + i * 6, y + 1);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,0.09)";
    for (let i = 0; i < 20; i++) {
      ctx.fillRect((i * 79 + time * 10) % (W + 80) - 40, 410 + (i % 6) * 24, 34, 2);
    }
  }

  function drawUtilityLines(time) {
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 96);
    ctx.quadraticCurveTo(260, 132 + Math.sin(time) * 2, 520, 102);
    ctx.quadraticCurveTo(680, 84, W, 118);
    ctx.moveTo(0, 132);
    ctx.quadraticCurveTo(284, 158, 548, 126);
    ctx.quadraticCurveTo(704, 110, W, 146);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.44)";
    ctx.fillRect(126, 80, 8, 278);
    ctx.fillRect(736, 72, 8, 286);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(120, 122, 20, 5);
    ctx.fillRect(730, 118, 20, 5);
  }

  function drawStudioGear(time) {
    const activeRing = getLookLabel("backdrop") === "ring light" || state.reelTimer > 0;
    ctx.save();
    ctx.translate(128, 266);
    ctx.strokeStyle = activeRing ? "#ffd43b" : "rgba(255,255,255,0.48)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 46 + Math.sin(time * 4) * (activeRing ? 2 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 48);
    ctx.lineTo(-22, 158);
    ctx.moveTo(0, 48);
    ctx.lineTo(24, 158);
    ctx.moveTo(0, 48);
    ctx.lineTo(0, 165);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(548, 272, 64, 38, 8);
    ctx.fill();
    ctx.strokeStyle = "#2ee0ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#2ee0ff";
    ctx.fillRect(560, 284, 38, 4);
  }

  function drawReelFrame(time) {
    const x = 214;
    const y = 54;
    const w = 350;
    const h = 438;
    ctx.save();
    ctx.fillStyle = "rgba(2,4,12,0.28)";
    roundRect(x, y, w, h, 28);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,212,59,${0.32 + state.reelTimer * 0.22})`;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.52)";
    roundRect(x + 18, y + 16, w - 36, 34, 14);
    ctx.fill();
    ctx.fillStyle = state.reelTimer > 0 ? "#ff5c5c" : "#6bff7d";
    ctx.beginPath();
    ctx.arc(x + 36, y + 33, 6 + Math.sin(time * 8) * (state.reelTimer > 0 ? 1.5 : 0), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Bungee, Impact, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(state.reelTimer > 0 ? "REC · REEL POSTING" : "CONSENT CAMERA", x + 52, y + 37);

    ctx.fillStyle = "rgba(46,224,255,0.13)";
    roundRect(x + 24, y + h - 78, w - 48, 44, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(46,224,255,0.36)";
    ctx.stroke();
    ctx.fillStyle = "#2ee0ff";
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.fillText("SUBJECT APPROVED · RESOURCES LINKED", x + 42, y + h - 52);
    ctx.fillStyle = "rgba(234,247,255,0.72)";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText(`POST ${state.posts}/${POSTS_TO_END} · HYPE ${Math.round(state.hype)}`, x + 42, y + h - 36);
    ctx.restore();
  }

  function drawSocialPanel(time) {
    const x = 642;
    const y = 54;
    const w = 220;
    const h = 422;
    ctx.fillStyle = "rgba(3,5,12,0.82)";
    roundRect(x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(46,224,255,0.36)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,46,136,0.12)";
    roundRect(x + 10, y + 10, w - 20, 72, 12);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Bungee, Impact, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("LIVE FEED", x + 18, y + 31);
    ctx.fillStyle = "#ff2e88";
    ctx.font = "bold 28px Bungee, Impact, sans-serif";
    ctx.fillText(moneyLikes(state.likes), x + 18, y + 65);
    ctx.fillStyle = "rgba(234,247,255,0.64)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText("LIKES · COMMENTS WATCHING", x + 20, y + 80);

    const styleY = y + 112;
    drawMiniBar(x + 18, styleY, w - 36, "STYLE", state.style, "#ffd43b");
    drawMiniBar(x + 18, styleY + 40, w - 36, "RESPECT", state.respect, state.respect < 34 ? "#ff5c5c" : "#6bff7d");
    drawMiniBar(x + 18, styleY + 80, w - 36, "HYPE", state.hype, "#2ee0ff");

    const checklistY = y + 232;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(x + 14, checklistY, w - 28, 58, 10);
    ctx.fill();
    ctx.fillStyle = "#ffd43b";
    ctx.font = "bold 9px Bungee, Impact, sans-serif";
    ctx.fillText("SHOOT ETHICS", x + 24, checklistY + 20);
    ctx.fillStyle = state.respect > 45 ? "#6bff7d" : "#ff5c5c";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText(state.respect > 45 ? "✓ consent visible" : "! repair respect", x + 24, checklistY + 38);
    ctx.fillStyle = state.posts < POSTS_TO_END ? "#2ee0ff" : "#ffd43b";
    ctx.fillText(`✓ resources caption ${state.posts}/${POSTS_TO_END}`, x + 118, checklistY + 38);

    const [author, text] = state.lastComment;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(x + 14, y + 314, w - 28, 82, 10);
    ctx.fill();
    ctx.fillStyle = "#ffd43b";
    ctx.font = "bold 8.5px Bungee, Impact, sans-serif";
    ctx.fillText(author.toUpperCase().slice(0, 20), x + 26, y + 334);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "9px JetBrains Mono, monospace";
    wrapText(text, x + 26, y + 350, w - 52, 12, 3);

    ctx.fillStyle = `rgba(255,212,59,${0.16 + state.pulse * 0.1})`;
    ctx.beginPath();
    ctx.arc(x + w - 28, y + 32, 14 + Math.sin(time * 3) * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#05070d";
    ctx.font = "bold 12px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("RB", x + w - 28, y + 37);

    for (const f of state.floats) {
      const a = 1 - f.age / f.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.font = "bold 13px Bungee, Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawMiniBar(x, y, w, label, value, color) {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(x, y + 12, w, 8, 5);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(x, y + 12, w * (clamp(value, 0, 100) / 100), 8, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(234,247,255,0.72)";
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(label, x, y + 7);
    ctx.textAlign = "right";
    ctx.fillText(Math.round(value), x + w, y + 7);
  }

  function drawCharacter(cx, footY, time) {
    const gender = state.gender;
    const skin = gender === "female" ? "#b87956" : "#9f6549";
    const look = {
      hair: getLookLabel("hair"),
      makeup: getLookLabel("makeup"),
      outfit: getLookLabel("outfit"),
      accessory: getLookLabel("accessory"),
    };
    const bob = Math.sin(time * 2.1) * 2 + state.pulse * -5;
    const sprite = gender === "female" ? art.whiteWoman : art.blackMale;

    if (imageReady(sprite)) {
      drawGeneratedCharacter(sprite, cx, footY + bob, look, time);
      return;
    }

    drawCharacterAura(cx, footY - 166, time);
    drawCharacterShadow(cx, footY);
    drawBody(cx, footY + bob, skin, look);
    drawHead(cx, footY - 214 + bob, skin, look, gender, time);
    drawHair(cx, footY - 244 + bob, look.hair, gender);
    drawAccessories(cx, footY - 214 + bob, look, time);
    drawNameBadge(cx, footY - 354 + bob);
  }

  function drawGeneratedCharacter(sprite, cx, footY, look, time) {
    const drawW = state.gender === "female" ? 292 : 286;
    const drawH = drawW * (sprite.naturalHeight / sprite.naturalWidth);
    const x = cx - drawW / 2;
    const y = footY - drawH;

    drawCharacterAura(cx, footY - drawH * 0.56, time);
    drawCharacterShadow(cx, footY + 2);

    ctx.save();
    ctx.shadowColor = state.reelTimer > 0 ? "rgba(255,212,59,0.58)" : "rgba(46,224,255,0.34)";
    ctx.shadowBlur = 14 + state.pulse * 16;
    ctx.drawImage(sprite, x, y, drawW, drawH);
    ctx.restore();

    drawGeneratedStyleOverlays(cx, footY, drawH, look, time);
    drawNameBadge(cx, footY - 376);
  }

  function drawGeneratedStyleOverlays(cx, footY, drawH, look, time) {
    const faceY = footY - drawH * 0.72;
    const chestY = footY - drawH * 0.42;
    const outfitColor = {
      "worn hoodie": "rgba(234,247,255,0.22)",
      "fresh hoodie": "#2ee0ff",
      "thrift blazer": "#7a4df0",
      "velvet jacket": "#ff2e88",
      "star jacket": "#ffd43b",
    }[look.outfit] || "#2ee0ff";

    ctx.save();
    ctx.globalAlpha = look.outfit === "worn hoodie" ? 0.22 : 0.45;
    ctx.strokeStyle = outfitColor;
    ctx.lineWidth = 8;
    ctx.setLineDash([14, 10]);
    roundRect(cx - 126, chestY - 56, 252, 166, 34);
    ctx.stroke();
    ctx.restore();

    if (look.makeup !== "none") {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = look.makeup === "neon liner" ? "#2ee0ff" : "#ff2e88";
      ctx.lineWidth = look.makeup === "full glam" ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(cx - 44, faceY - 7);
      ctx.quadraticCurveTo(cx - 22, faceY - 20, cx - 3, faceY - 7);
      ctx.moveTo(cx + 44, faceY - 7);
      ctx.quadraticCurveTo(cx + 22, faceY - 20, cx + 3, faceY - 7);
      ctx.stroke();
      ctx.fillStyle = look.makeup === "full glam" || look.makeup === "glow balm" ? "rgba(255,46,136,0.34)" : "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.ellipse(cx - 46, faceY + 28, 17, 8, -0.25, 0, Math.PI * 2);
      ctx.ellipse(cx + 46, faceY + 28, 17, 8, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (look.hair !== "beanie") {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = look.hair === "silver shag" ? "#e5eef6" : "#ffd43b";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      for (let i = 0; i < 8; i++) {
        const side = i % 2 ? 1 : -1;
        const offset = 16 + i * 5;
        ctx.beginPath();
        ctx.moveTo(cx + side * offset, faceY - 72 + i * 3);
        ctx.quadraticCurveTo(cx + side * (70 + i * 4), faceY - 24 + i * 3, cx + side * (52 + i * 5), faceY + 55 + i * 3);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawAccessories(cx, faceY, look, time);
  }

  function drawCharacterAura(cx, cy, time) {
    const radius = 120 + state.style * 0.7 + state.pulse * 18;
    const grad = ctx.createRadialGradient(cx, cy, 22, cx, cy, radius);
    grad.addColorStop(0, `rgba(255,212,59,${0.08 + state.pulse * 0.05})`);
    grad.addColorStop(0.42, `rgba(255,46,136,${0.07 + state.style / 1600})`);
    grad.addColorStop(1, "rgba(46,224,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    if (state.style > 62) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 0.18);
      ctx.globalAlpha = 0.12 + state.pulse * 0.08;
      ctx.fillStyle = "#ffd43b";
      for (let i = 0; i < 10; i++) {
        ctx.rotate(Math.PI / 5);
        ctx.fillRect(88, -1, 38, 2);
      }
      ctx.restore();
    }
  }

  function drawCharacterShadow(cx, y) {
    const grad = ctx.createRadialGradient(cx, y - 12, 8, cx, y - 12, 120);
    grad.addColorStop(0, "rgba(0,0,0,0.42)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, y - 10, 116, 26, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBody(cx, footY, skin, look) {
    const outfit = look.outfit;
    const palette = {
      "worn hoodie": ["#3d4356", "#232838"],
      "fresh hoodie": ["#2ee0ff", "#0b5e70"],
      "thrift blazer": ["#7a4df0", "#21133f"],
      "velvet jacket": ["#ff2e88", "#44122b"],
      "star jacket": ["#ffd43b", "#5f3900"],
    }[outfit] || ["#2ee0ff", "#0b5e70"];

    ctx.fillStyle = "rgba(0,0,0,0.38)";
    roundRect(cx - 112, footY - 184, 224, 186, 46);
    ctx.fill();

    const neck = ctx.createLinearGradient(0, footY - 190, 0, footY - 128);
    neck.addColorStop(0, lighten(skin, 14));
    neck.addColorStop(1, darken(skin, 14));
    ctx.fillStyle = neck;
    roundRect(cx - 32, footY - 198, 64, 74, 24);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const hood = ctx.createLinearGradient(0, footY - 186, 0, footY - 110);
    hood.addColorStop(0, lighten(palette[0], 8));
    hood.addColorStop(1, darken(palette[1], 4));
    ctx.fillStyle = hood;
    ctx.beginPath();
    ctx.ellipse(cx, footY - 140, 86, 56, 0, Math.PI, 0);
    ctx.lineTo(cx + 72, footY - 114);
    ctx.quadraticCurveTo(cx, footY - 86, cx - 72, footY - 114);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const torso = ctx.createLinearGradient(0, footY - 178, 0, footY);
    torso.addColorStop(0, palette[0]);
    torso.addColorStop(1, palette[1]);
    ctx.fillStyle = torso;
    ctx.beginPath();
    ctx.moveTo(cx - 80, footY - 160);
    ctx.quadraticCurveTo(cx - 122, footY - 116, cx - 104, footY - 46);
    ctx.lineTo(cx - 70, footY + 2);
    ctx.lineTo(cx + 70, footY + 2);
    ctx.lineTo(cx + 104, footY - 46);
    ctx.quadraticCurveTo(cx + 122, footY - 116, cx + 80, footY - 160);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 3;
    ctx.stroke();

    const centerGlow = ctx.createLinearGradient(cx - 70, 0, cx + 70, 0);
    centerGlow.addColorStop(0, "rgba(255,255,255,0)");
    centerGlow.addColorStop(0.5, "rgba(255,255,255,0.13)");
    centerGlow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = centerGlow;
    ctx.beginPath();
    ctx.moveTo(cx - 42, footY - 156);
    ctx.quadraticCurveTo(cx, footY - 108, cx + 42, footY - 156);
    ctx.lineTo(cx + 54, footY - 12);
    ctx.lineTo(cx - 54, footY - 12);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - 78 + i * 38, footY - 134);
      ctx.quadraticCurveTo(cx - 64 + i * 30, footY - 82, cx - 72 + i * 38, footY - 22);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = outfit === "worn hoodie" ? "rgba(255,255,255,0.16)" : "#ffd43b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 32, footY - 154);
    ctx.quadraticCurveTo(cx, footY - 104, cx + 32, footY - 154);
    ctx.stroke();

    ctx.strokeStyle = outfit === "worn hoodie" ? "rgba(234,247,255,0.36)" : "rgba(255,212,59,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, footY - 143);
    ctx.quadraticCurveTo(cx - 15, footY - 112, cx - 8, footY - 82);
    ctx.moveTo(cx + 12, footY - 143);
    ctx.quadraticCurveTo(cx + 15, footY - 112, cx + 8, footY - 82);
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    roundRect(cx - 50, footY - 58, 100, 34, 13);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.stroke();

    if (outfit === "thrift blazer" || outfit === "velvet jacket" || outfit === "star jacket") {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(cx - 66, footY - 144);
      ctx.lineTo(cx - 12, footY - 58);
      ctx.lineTo(cx - 48, footY - 42);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 66, footY - 144);
      ctx.lineTo(cx + 12, footY - 58);
      ctx.lineTo(cx + 48, footY - 42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,212,59,0.46)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 66, footY - 144);
      ctx.lineTo(cx - 13, footY - 59);
      ctx.moveTo(cx + 66, footY - 144);
      ctx.lineTo(cx + 13, footY - 59);
      ctx.stroke();
      ctx.fillStyle = "#ffd43b";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(cx + 20, footY - 100 + i * 23, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (outfit === "star jacket") {
        ctx.fillStyle = "rgba(255,255,255,0.58)";
        for (let i = 0; i < 9; i++) {
          drawStar(cx - 88 + (i % 3) * 88, footY - 132 + Math.floor(i / 3) * 38, 5);
        }
      }
    }

    const arm = ctx.createLinearGradient(0, footY - 114, 0, footY - 36);
    arm.addColorStop(0, lighten(skin, 10));
    arm.addColorStop(1, darken(skin, 12));
    ctx.fillStyle = arm;
    ctx.beginPath();
    ctx.ellipse(cx - 102, footY - 72, 18, 34, -0.35, 0, Math.PI * 2);
    ctx.ellipse(cx + 102, footY - 72, 18, 34, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  function drawHead(cx, cy, skin, look, gender, time) {
    const glam = state.style / 100;
    const faceW = gender === "female" ? 59 : 64;
    const faceH = gender === "female" ? 72 : 76;
    const jawW = gender === "female" ? 41 : 46;
    const chinY = cy + 62;
    const face = ctx.createRadialGradient(cx - 20, cy - 28, 8, cx, cy, 94);
    face.addColorStop(0, lighten(skin, 24));
    face.addColorStop(0.55, skin);
    face.addColorStop(1, darken(skin, 20));
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.ellipse(cx, cy, faceW, faceH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const jaw = ctx.createLinearGradient(0, cy + 18, 0, chinY + 10);
    jaw.addColorStop(0, skin);
    jaw.addColorStop(1, darken(skin, 16));
    ctx.fillStyle = jaw;
    ctx.beginPath();
    ctx.moveTo(cx - faceW + 8, cy + 18);
    ctx.lineTo(cx - jawW, cy + 48);
    ctx.quadraticCurveTo(cx, chinY + 12, cx + jawW, cy + 48);
    ctx.lineTo(cx + faceW - 8, cy + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.42)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(cx - faceW + 2, cy + 4, 11, 18, -0.2, 0, Math.PI * 2);
    ctx.ellipse(cx + faceW - 2, cy + 4, 11, 18, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.34)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = `rgba(255,255,255,${0.10 + glam * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(cx - 29, cy + 9, 18, 8, -0.18, 0, Math.PI * 2);
    ctx.ellipse(cx + 29, cy + 9, 18, 8, 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx - 21, cy + 37, 14, 5, -0.1, 0, Math.PI * 2);
    ctx.ellipse(cx + 21, cy + 37, 14, 5, 0.1, 0, Math.PI * 2);
    ctx.fill();

    const eyeColor = glam > 0.7 ? "#2ee0ff" : "#111827";
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.beginPath();
    ctx.ellipse(cx - 23, cy - 6, 16, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 23, cy - 6, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(cx - 22, cy - 8, 11, 7, -0.04, 0, Math.PI * 2);
    ctx.ellipse(cx + 22, cy - 8, 11, 7, 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = eyeColor;
    ctx.beginPath();
    ctx.arc(cx - 22, cy - 8, 4, 0, Math.PI * 2);
    ctx.arc(cx + 22, cy - 8, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.beginPath();
    ctx.arc(cx - 23.5, cy - 10, 1.5, 0, Math.PI * 2);
    ctx.arc(cx + 20.5, cy - 10, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.42)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy - 12);
    ctx.quadraticCurveTo(cx - 22, cy - 17, cx - 10, cy - 11);
    ctx.moveTo(cx + 34, cy - 12);
    ctx.quadraticCurveTo(cx + 22, cy - 17, cx + 10, cy - 11);
    ctx.stroke();

    ctx.strokeStyle = "#26120c";
    ctx.lineWidth = look.hair === "beanie" ? 2 : 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 36, cy - 26);
    ctx.quadraticCurveTo(cx - 23, cy - 34, cx - 10, cy - 29);
    ctx.moveTo(cx + 36, cy - 26);
    ctx.quadraticCurveTo(cx + 23, cy - 34, cx + 10, cy - 29);
    ctx.stroke();
    ctx.lineCap = "butt";

    if (look.makeup !== "none") {
      ctx.strokeStyle = look.makeup === "neon liner" ? "#2ee0ff" : "#1b1028";
      ctx.lineWidth = look.makeup === "full glam" ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(cx - 34, cy - 12);
      ctx.quadraticCurveTo(cx - 22, cy - 19, cx - 9, cy - 12);
      ctx.moveTo(cx + 34, cy - 12);
      ctx.quadraticCurveTo(cx + 22, cy - 19, cx + 9, cy - 12);
      ctx.stroke();

      ctx.fillStyle = look.makeup === "glow balm" || look.makeup === "full glam" ? "rgba(255,46,136,0.24)" : "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.ellipse(cx - 34, cy + 20, 11, 5, -0.25, 0, Math.PI * 2);
      ctx.ellipse(cx + 34, cy + 20, 11, 5, 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `rgba(255,255,255,${0.12 + glam * 0.16})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 44, cy + 14);
    ctx.quadraticCurveTo(cx - 24, cy + 28, cx - 8, cy + 22);
    ctx.moveTo(cx + 44, cy + 14);
    ctx.quadraticCurveTo(cx + 24, cy + 28, cx + 8, cy + 22);
    ctx.stroke();

    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 1);
    ctx.quadraticCurveTo(cx + 10, cy + 13, cx + 1, cy + 23);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx - 5, cy + 11, 4, 15, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(cx - 9, cy + 24, 3, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 8, cy + 24, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = look.makeup === "full glam" || look.makeup === "glow balm" ? "#db5c75" : "#7e332d";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 39, 17 + glam * 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.56)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy + 31, 18, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx - 5, cy + 37, 6, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (glam > 0.55) {
      ctx.strokeStyle = `rgba(255,212,59,${(glam - 0.45) * 0.5})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - 49, cy + 28);
      ctx.lineTo(cx - 30, cy + 56);
      ctx.quadraticCurveTo(cx, cy + 78, cx + 30, cy + 56);
      ctx.lineTo(cx + 49, cy + 28);
      ctx.stroke();
    }

    if (state.pulse > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.2 + state.pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 46, cy + 20);
      ctx.quadraticCurveTo(cx - 22, cy + 34, cx - 4, cy + 26);
      ctx.moveTo(cx + 46, cy + 20);
      ctx.quadraticCurveTo(cx + 22, cy + 34, cx + 4, cy + 26);
      ctx.stroke();
    }

    if (state.reelTimer > 0) {
      ctx.fillStyle = `rgba(255,212,59,${0.14 + state.reelTimer * 0.08})`;
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 92 + Math.sin(time * 8) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHair(cx, cy, hair, gender) {
    if (hair === "beanie") {
      const cap = ctx.createLinearGradient(0, cy - 22, 0, cy + 28);
      cap.addColorStop(0, "#4e3a65");
      cap.addColorStop(1, "#241a34");
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 7, 68, 34, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#ff2e88";
      roundRect(cx - 56, cy + 5, 112, 18, 9);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 52 + i * 15, cy - 6);
        ctx.quadraticCurveTo(cx - 48 + i * 13, cy + 5, cx - 46 + i * 14, cy + 20);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,212,59,0.26)";
      ctx.fillRect(cx - 40, cy + 10, 80, 3);
      return;
    }

    ctx.fillStyle = hair === "silver sweep" ? "#d9e6ef" : hair === "high pony" ? "#21100a" : "#2a130b";
    if (hair === "clean fade") {
      ctx.beginPath();
      ctx.ellipse(cx, cy + 3, 62, 26, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(cx - 30, cy - 4, 60, 4);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 34 + i * 22, cy - 14);
        ctx.lineTo(cx - 42 + i * 22, cy + 10);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(46,224,255,0.22)";
      ctx.beginPath();
      ctx.moveTo(cx - 44, cy + 8);
      ctx.quadraticCurveTo(cx, cy + 19, cx + 44, cy + 8);
      ctx.stroke();
    } else if (hair === "textured curls" || hair === "box braids") {
      for (let i = 0; i < 15; i++) {
        const a = Math.PI + (i / 14) * Math.PI;
        const x = cx + Math.cos(a) * 58;
        const y = cy + Math.sin(a) * 25 + 18;
        ctx.beginPath();
        ctx.arc(x, y, hair === "box braids" ? 8 : 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.arc(x - 3, y - 4, hair === "box braids" ? 2 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hair === "box braids" ? "#21100a" : "#2a130b";
      }
      if (hair === "box braids") {
        for (let i = 0; i < 9; i++) {
          const x = cx - 52 + i * 13;
          ctx.strokeStyle = "#21100a";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(x, cy + 18);
          ctx.quadraticCurveTo(x - 4, cy + 64, x + 2, cy + 102);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.10)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x - 2, cy + 24);
          ctx.quadraticCurveTo(x - 7, cy + 62, x - 1, cy + 96);
          ctx.stroke();
        }
      }
    } else if (hair === "high pony") {
      ctx.beginPath();
      ctx.ellipse(cx, cy + 12, 64, 30, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 48, cy + 8, 24, 58, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 40, cy - 12);
      ctx.quadraticCurveTo(cx + 68, cy + 26, cx + 54, cy + 62);
      ctx.stroke();
    } else if (hair === "soft bob") {
      ctx.beginPath();
      ctx.ellipse(cx, cy + 42, 74, 84, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#b87956";
      ctx.beginPath();
      ctx.ellipse(cx, cy + 52, 48, 60, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 44 + i * 22, cy - 4);
        ctx.quadraticCurveTo(cx - 54 + i * 22, cy + 38, cx - 42 + i * 19, cy + 80);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 70, 30, -0.1, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.24)";
      ctx.fillRect(cx - 6, cy - 16, 38, 5);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 4, cy - 14);
      ctx.quadraticCurveTo(cx + 30, cy - 4, cx + 48, cy + 16);
      ctx.stroke();
    }

    if (gender === "female" && hair !== "soft bob" && hair !== "high pony" && hair !== "box braids") {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(cx - 58, cy + 42, 16, 42, 0.12, 0, Math.PI * 2);
      ctx.ellipse(cx + 58, cy + 42, 16, 42, -0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAccessories(cx, cy, look, time) {
    if (look.accessory === "shades") {
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      roundRect(cx - 42, cy - 20, 31, 16, 5);
      ctx.fill();
      roundRect(cx + 11, cy - 20, 31, 16, 5);
      ctx.fill();
      ctx.fillRect(cx - 11, cy - 14, 22, 4);
      ctx.strokeStyle = "#ffd43b";
      ctx.stroke();
    }

    if (look.accessory === "silver chain") {
      ctx.strokeStyle = "#d9e6ef";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy + 100, 34, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#ffd43b";
      ctx.beginPath();
      ctx.arc(cx, cy + 130, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    if (look.accessory === "silk scarf") {
      ctx.fillStyle = "#ff2e88";
      ctx.beginPath();
      ctx.moveTo(cx - 44, cy + 82);
      ctx.quadraticCurveTo(cx, cy + 116, cx + 44, cy + 82);
      ctx.lineTo(cx + 30, cy + 118);
      ctx.quadraticCurveTo(cx, cy + 104, cx - 30, cy + 118);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffd43b";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (look.accessory === "vape") {
      ctx.save();
      ctx.translate(cx + 96, cy + 88);
      ctx.rotate(-0.35);
      ctx.fillStyle = "#2ee0ff";
      roundRect(-7, -5, 42, 10, 5);
      ctx.fill();
      ctx.fillStyle = "#ffd43b";
      ctx.fillRect(27, -4, 8, 8);
      ctx.restore();

      for (let i = 0; i < 5; i++) {
        const r = 8 + i * 6 + Math.sin(time * 2 + i) * 2;
        ctx.strokeStyle = `rgba(234,247,255,${0.28 - i * 0.035})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx + 126 + i * 11, cy + 72 - i * 9, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawNameBadge(cx, y) {
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    roundRect(cx - 114, y, 228, 40, 12);
    ctx.fill();
    ctx.strokeStyle = state.respect < 34 ? "#ff5c5c" : "#2ee0ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.name.toUpperCase(), cx, y + 16);
    ctx.fillStyle = "rgba(234,247,255,0.64)";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText("STYLE SUBJECT · ADULT PARTICIPANT", cx, y + 30);
  }

  function drawLowerBar(time) {
    const button = postButtonRect();
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    roundRect(28, H - 94, W - 56, 76, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#ffd43b";
    ctx.font = "bold 14px Bungee, Impact, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("CURRENT LOOK", 48, H - 62);

    const labels = [
      ["HAIR", getLookLabel("hair"), "#2ee0ff"],
      ["MAKEUP", getLookLabel("makeup"), "#ff2e88"],
      ["FIT", getLookLabel("outfit"), "#ffd43b"],
      ["EXTRA", getLookLabel("accessory"), "#6bff7d"],
    ];
    labels.forEach(([key, value, color], i) => {
      const x = 198 + i * 112;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      roundRect(x, H - 76, 98, 42, 9);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.58;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.font = "bold 8px JetBrains Mono, monospace";
      ctx.fillText(key, x + 9, H - 60);
      ctx.fillStyle = "rgba(234,247,255,0.82)";
      ctx.font = "bold 8.5px JetBrains Mono, monospace";
      ctx.fillText(value.toUpperCase().slice(0, 12), x + 9, H - 44);
    });

    const postPulse = 0.65 + Math.sin(time * 5) * 0.12 + state.pulse * 0.22;
    ctx.fillStyle = `rgba(46,224,255,${postPulse})`;
    roundRect(button.x, button.y, button.w, button.h, 12);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#05070d";
    ctx.font = "bold 15px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("POST REEL", button.x + button.w / 2, button.y + 32);
  }

  function drawParticles() {
    for (const p of state.particles) {
      const alpha = 1 - p.age / p.life;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFlash() {
    if (state.flash <= 0) return;
    ctx.fillStyle = state.respect < 34 ? `rgba(255,92,92,${state.flash * 0.22})` : `rgba(255,255,255,${state.flash * 0.18})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPause() {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 38px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PAUSED", W / 2, H / 2);
  }

  function spawnBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 70 + Math.random() * 150;
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        color,
        size: 2 + Math.random() * 4,
        age: 0,
        life: 0.55 + Math.random() * 0.55,
      });
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

  function drawStar(x, y, radius) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 === 0 ? radius : radius * 0.45;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function lighten(hex, amount) {
    return shiftColor(hex, amount);
  }

  function darken(hex, amount) {
    return shiftColor(hex, -amount);
  }

  function shiftColor(hex, amount) {
    const value = hex.replace("#", "");
    const n = parseInt(value, 16);
    const r = clamp((n >> 16) + amount, 0, 255);
    const g = clamp(((n >> 8) & 255) + amount, 0, 255);
    const b = clamp((n & 255) + amount, 0, 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function wrapText(text, x, y, maxWidth, lineHeight, maxLines = 3) {
    const words = text.split(" ");
    let line = "";
    let lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = words[i];
        y += lineHeight;
        lines += 1;
        if (lines >= maxLines) return;
      } else {
        line = test;
      }
    }
    if (line && lines < maxLines) ctx.fillText(line, x, y);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function bind() {
    el.primary.addEventListener("click", () => {
      if (state.paused) togglePause();
      else if (state.gameOver) {
        reset(true);
        startGame();
      } else startGame();
    });
    [el.male, el.sideMale].forEach((button) => button.addEventListener("click", () => chooseGender("male")));
    [el.female, el.sideFemale].forEach((button) => button.addEventListener("click", () => chooseGender("female")));
    el.pause.addEventListener("click", togglePause);
    el.restart.addEventListener("click", () => {
      reset(true);
      showOverlay("SKID ROW GLOW-UP", "Pick a participant, build the look, and keep the comments from turning into a courtroom.", "Start shoot");
    });
    el.postMobile.addEventListener("click", postReel);

    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * (W / rect.width);
      const y = (event.clientY - rect.top) * (H / rect.height);
      const button = postButtonRect();
      if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) postReel();
      else if (!state.running) startGame();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!state.running) startGame();
        else postReel();
      } else if (event.key === "p" || event.key === "P" || event.key === "Escape") {
        togglePause();
      } else if (/^[1-9]$/.test(event.key)) {
        const action = actionDefs[Number(event.key) - 1];
        if (action) action.effect();
      } else if (event.key === "0") {
        actionDefs[9].effect();
      }
    });
  }

  function init() {
    loadArt();
    renderActions();
    bind();
    reset(false);
    showOverlay("SKID ROW GLOW-UP", "Pick a consenting adult participant, build the look, and keep the comments from turning into a courtroom.", "Start shoot");
  }

  init();
})();
