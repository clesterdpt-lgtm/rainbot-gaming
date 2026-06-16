/* ============================================
   SMOOTH BRAIN SNACKER — a snake parody
   - You're a brain worm. Eat smart, responsible ideas.
   - Every idea you digest comes out the other end as pure brainrot,
     and that brainrot IS your ever-growing tail.
   - Hit a wall or your own brainrot and it's lights out.
   - Canvas grid snake. Debug hook: window.__SNACK
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "smoothbrain";
  const COLS = 25;
  const ROWS = 25;
  const CELL = 28; // canvas is COLS*CELL = 700 px square
  const W = COLS * CELL;
  const H = ROWS * CELL;

  const START_LEN = 4;
  const BASE_STEP = 140; // ms per move at the start
  const MIN_STEP = 68; // fastest it ever gets
  const STEP_RAMP = 2.1; // ms shaved per body segment grown
  const GOLD_EVERY = 5; // every Nth idea, a Big Brain bonus appears
  const GOLD_TTL = 7200; // ms a Big Brain idea lingers before it ghosts you

  // Brand palette (mirrors styles.css :root)
  const C = {
    bg0: "#0c0a1a",
    bg1: "#080810",
    grid: "rgba(255,255,255,0.035)",
    ink: "#fbfaf4",
    dim: "#b6b3c9",
    pink: "#ff2e88",
    cyan: "#2ee0ff",
    yellow: "#ffd43b",
    purple: "#b06cff",
  };

  const BRAIN_BG_SRC = "../assets/img/smooth-brain-snacker/brain-material-bg-v2.png?v=20260616-2";
  const brainBg = new Image();
  let brainBgReady = false;
  brainBg.decoding = "async";
  brainBg.onload = () => {
    brainBgReady = true;
    if (snake) draw();
  };
  brainBg.src = BRAIN_BG_SRC;

  // Smart, responsible ideas — the food.
  const SMART_IDEAS = [
    { e: "📚", t: "Read a book" },
    { e: "💧", t: "Drink some water" },
    { e: "🥦", t: "Eat a vegetable" },
    { e: "😴", t: "Sleep 8 hours" },
    { e: "🚶", t: "Go for a walk" },
    { e: "☎️", t: "Call your mom" },
    { e: "💰", t: "Save for retirement" },
    { e: "🧘", t: "Meditate" },
    { e: "📄", t: "File your taxes" },
    { e: "🦷", t: "Floss your teeth" },
    { e: "✍️", t: "Journal a little" },
    { e: "🎓", t: "Learn a real skill" },
    { e: "🌱", t: "Touch grass" },
    { e: "🛏️", t: "Make your bed" },
    { e: "🧾", t: "Make a budget" },
    { e: "🥗", t: "Meal prep" },
  ];

  // Terrible ideas — what comes out the other end. Two flavors:
  // short brainrot slang, and full-blown concrete bad life decisions.
  const BRAINROT = [
    "Skibidi", "Rizz", "Gyatt", "Sigma grindset", "Ohio", "Fanum tax",
    "Mewing", "Gooning", "NPC behavior", "Mogging", "No cap", "Bussin",
    "Edging", "Delulu", "Aura farming", "Looksmaxxing", "Mid", "Glazing",
    "Rizzler", "-7", "Chopped", "Doomscrolling", "Brainrot", "Skibidi Ohio rizz",
  ];
  const BAD_CHOICES = [
    "Spend inheritance on meme coins",
    "Day-trade the rent money",
    "Reply-all to the whole company",
    "Text your ex at 3 AM",
    "Cancel the dentist again",
    "Buy a boat on a credit card",
    "Quit your job to sell NFTs",
    "Marry someone you met Tuesday",
    "Co-sign a stranger's loan",
    "Get a face tattoo",
    "Ghost your therapist",
    "Refinance the house for a hot tub",
    "Invest in your cousin's app",
    "Eat the gas-station sushi",
    "Argue with strangers online",
    "Put it all on red",
    "Start a podcast instead",
    "Skip leg day forever",
    "Adopt a raccoon",
    "Doomscroll until sunrise",
    "Max out a third credit card",
    "Trust the group chat's stock tip",
  ];
  const ROT_POOL = BRAINROT.concat(BAD_CHOICES);
  function randomRot() {
    return ROT_POOL[(Math.random() * ROT_POOL.length) | 0];
  }

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  // ---------- DOM ----------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnNew = document.getElementById("btn-new");
  const btnPause = document.getElementById("btn-pause");
  const btnSound = document.getElementById("btn-sound");
  const scoreEl = document.getElementById("hud-score");
  const lenEl = document.getElementById("hud-len");
  const bestEl = document.getElementById("hud-best");
  const menuEl = document.getElementById("menu-idea");
  const feedEl = document.getElementById("feed");

  // ---------- State ----------
  let snake; // array of {x,y}; index 0 is the head
  let dir; // {x,y} currently applied heading
  let inputQ; // queued direction changes (max 2)
  let food; // {x, y, idea}
  let gold; // {x, y, ttl, phrase} | null
  let eaten; // count of ideas digested (drives gold cadence)
  let score = 0;
  let best = 0;
  let bestAtStart = 0;
  let floats; // floating text [{x,y,text,color,ttl,life}]
  let poops; // ground poops left behind [{x,y,phrase,ttl,life,labelTtl}]
  let feed; // recent brainrot phrases (strings)

  let running = false; // a run is live (not dead, not pre-start)
  let paused = false;
  let started = false; // has the player begun at least once

  let acc = 0; // step accumulator (ms)
  let lastT = 0;
  let rafId = 0;
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;

  const stepMs = () =>
    Math.max(MIN_STEP, BASE_STEP - (snake.length - START_LEN) * STEP_RAMP);

  // ---------- Sound ----------
  const SOUND_PREF_KEY = "rainbot_smoothbrain_sound";
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let soundOn = readSoundPreference();

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

  function playTone(freq, duration, options) {
    const ac = ensureAudio();
    if (!ac) return;
    const opts = options || {};
    const t0 = ac.currentTime + (opts.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain || 0.03, t0 + (opts.attack || 0.012));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function playSfx(name) {
    if (!soundOn) return;
    if (name === "turn") {
      playTone(180, 0.035, { type: "square", gain: 0.012 });
    } else if (name === "eat") {
      playTone(260, 0.06, { type: "square", to: 390, gain: 0.035 });
      playTone(520, 0.08, { type: "triangle", delay: 0.045, gain: 0.022 });
    } else if (name === "big") {
      [330, 495, 660].forEach((freq, i) =>
        playTone(freq, 0.1, { type: "triangle", delay: i * 0.055, gain: 0.03 })
      );
    } else if (name === "die") {
      playTone(160, 0.2, { type: "sawtooth", to: 55, gain: 0.042 });
      playTone(70, 0.23, { type: "sine", delay: 0.06, gain: 0.03 });
    } else if (name === "start") {
      playTone(196, 0.08, { type: "triangle", gain: 0.028 });
      playTone(392, 0.12, { type: "triangle", delay: 0.07, gain: 0.024 });
    } else if (name === "pause") {
      playTone(220, 0.08, { type: "sine", to: 150, gain: 0.022 });
    } else if (name === "resume") {
      playTone(260, 0.08, { type: "sine", to: 390, gain: 0.022 });
    } else if (name === "toggle") {
      playTone(440, 0.07, { type: "triangle", gain: 0.026 });
      playTone(660, 0.08, { type: "triangle", delay: 0.055, gain: 0.022 });
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
    if (!AudioContextCtor) return;
    soundOn = !soundOn;
    writeSoundPreference();
    setSoundLabel();
    if (soundOn) {
      ensureAudio();
      playSfx("toggle");
    }
  }

  // ---------- Helpers ----------
  const sameCell = (a, b) => a.x === b.x && a.y === b.y;

  function onSnake(x, y, skipTail) {
    const n = snake.length - (skipTail ? 1 : 0);
    for (let i = 0; i < n; i++) if (snake[i].x === x && snake[i].y === y) return true;
    return false;
  }

  function freeCell() {
    // Pick a random cell not currently occupied by the worm or the other pellet.
    let x, y, tries = 0;
    do {
      x = (Math.random() * COLS) | 0;
      y = (Math.random() * ROWS) | 0;
      tries++;
    } while (
      tries < 400 &&
      (onSnake(x, y, false) ||
        (food && food.x === x && food.y === y) ||
        (gold && gold.x === x && gold.y === y))
    );
    return { x, y };
  }

  function spawnFood() {
    const spot = freeCell();
    food = {
      x: spot.x,
      y: spot.y,
      idea: SMART_IDEAS[(Math.random() * SMART_IDEAS.length) | 0],
      labelTtl: 2800, // the good idea's name pops up overhead briefly when it appears
    };
  }

  function spawnGold() {
    const spot = freeCell();
    gold = {
      x: spot.x,
      y: spot.y,
      ttl: GOLD_TTL,
      phrase: randomRot(),
    };
  }

  function addFloat(cx, cy, text, color) {
    floats.push({
      x: cx * CELL + CELL / 2,
      y: cy * CELL + CELL / 2,
      text,
      color: color || C.cyan,
      ttl: 1100,
      life: 1100,
    });
    if (floats.length > 14) floats.shift();
  }

  // A poop dropped on the ground at the worm's back end. Lingers 5–9s and,
  // for the first couple of seconds, shows the brainrot it represents overhead.
  function dropPoop(x, y, phrase) {
    const life = 5000 + Math.random() * 4000;
    poops.push({ x, y, phrase, ttl: life, life, labelTtl: 2400 });
    if (poops.length > 30) poops.shift();
  }

  function pushFeed(phrase) {
    feed.unshift(phrase);
    if (feed.length > 6) feed.pop();
    renderFeed();
  }

  // ---------- Rendering: HUD + side panels ----------
  function updateHud() {
    if (scoreEl) scoreEl.textContent = score.toLocaleString();
    if (lenEl) lenEl.textContent = String(snake ? snake.length : START_LEN);
    if (bestEl) bestEl.textContent = api.getHighScore(GAME_ID).toLocaleString();
  }

  function renderMenu() {
    if (!menuEl) return;
    if (!food) {
      menuEl.innerHTML = "";
      return;
    }
    menuEl.innerHTML =
      '<span class="snack-menu__emoji">' + food.idea.e + "</span>" +
      '<span class="snack-menu__text">' + food.idea.t + "</span>";
  }

  function renderFeed() {
    if (!feedEl) return;
    if (!feed.length) {
      feedEl.innerHTML = '<li class="snack-feed__empty">Nothing rotting yet…</li>';
      return;
    }
    feedEl.innerHTML = feed
      .map((p, i) => '<li' + (i === 0 ? ' class="snack-feed__fresh"' : "") + ">" + p + "</li>")
      .join("");
  }

  // ---------- Rendering: canvas ----------
  function lerpHex(a, b, t) {
    const ah = parseInt(a.slice(1), 16),
      bh = parseInt(b.slice(1), 16);
    const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
    const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
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

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg0);
    g.addColorStop(1, C.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (brainBgReady && brainBg.naturalWidth && brainBg.naturalHeight) {
      const scale = Math.max(W / brainBg.naturalWidth, H / brainBg.naturalHeight);
      const dw = brainBg.naturalWidth * scale;
      const dh = brainBg.naturalHeight * scale;
      ctx.drawImage(brainBg, (W - dw) / 2, (H - dh) / 2, dw, dh);

      ctx.fillStyle = "rgba(5,6,12,0.34)";
      ctx.fillRect(0, 0, W, H);

      const vignette = ctx.createRadialGradient(W / 2, H / 2, W * 0.15, W / 2, H / 2, W * 0.72);
      vignette.addColorStop(0, "rgba(7,8,16,0)");
      vignette.addColorStop(1, "rgba(7,8,16,0.42)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < COLS; i++) {
      ctx.moveTo(i * CELL + 0.5, 0);
      ctx.lineTo(i * CELL + 0.5, H);
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.moveTo(0, j * CELL + 0.5);
      ctx.lineTo(W, j * CELL + 0.5);
    }
    ctx.stroke();
  }

  function drawPellet(cell, color, emoji, pulse) {
    const cx = cell.x * CELL + CELL / 2;
    const cy = cell.y * CELL + CELL / 2;
    const base = CELL * 0.34;
    const r = base * (pulse ? 1 + 0.14 * Math.sin(performance.now() / 180) : 1);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = pulse ? 26 : 16;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.font = Math.round(CELL * 0.62) + "px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, cx, cy + 1);
  }

  function drawHead(cell, color) {
    const x = cell.x * CELL;
    const y = cell.y * CELL;
    const pad = 2;

    ctx.save();
    ctx.shadowColor = C.pink;
    ctx.shadowBlur = 22;
    ctx.fillStyle = color;
    roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 9);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = C.cyan;
    roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 9);
    ctx.stroke();

    // brain wrinkles
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + CELL * 0.32, y + CELL * 0.34, 4, 0, Math.PI);
    ctx.arc(x + CELL * 0.66, y + CELL * 0.34, 4, 0, Math.PI);
    ctx.stroke();

    // eyes look toward travel direction
    const ex = dir.x * 3.2;
    const ey = dir.y * 3.2;
    const eyeY = y + CELL * 0.52;
    for (const sx of [0.34, 0.66]) {
      const cxp = x + CELL * sx;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(cxp, eyeY, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#160a12";
      ctx.beginPath();
      ctx.arc(cxp + ex, eyeY + ey, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // antennae on the leading edge
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2;
    const fx = x + CELL / 2 + dir.x * (CELL / 2 - 3);
    const fy = y + CELL / 2 + dir.y * (CELL / 2 - 3);
    for (const s of [-1, 1]) {
      const ax = fx + (dir.y !== 0 ? s * 5 : dir.x * 5);
      const ay = fy + (dir.x !== 0 ? s * 5 : dir.y * 5);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.fillStyle = C.yellow;
      ctx.beginPath();
      ctx.arc(ax, ay, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBody() {
    // tail -> just behind head, so the head draws on top
    for (let i = snake.length - 1; i >= 1; i--) {
      const s = snake[i];
      const t = i / Math.max(1, snake.length - 1); // 0 near head, 1 at tail
      const col =
        t < 0.5 ? lerpHex(C.pink, C.purple, t / 0.5) : lerpHex(C.purple, C.cyan, (t - 0.5) / 0.5);
      const x = s.x * CELL;
      const y = s.y * CELL;
      const pad = 3;

      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.fillStyle = col;
      roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 8);
      ctx.fill();
      ctx.restore();

      // faint squiggle of a half-formed thought
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + CELL * 0.32, y + CELL * 0.5);
      ctx.quadraticCurveTo(x + CELL * 0.5, y + CELL * 0.34, x + CELL * 0.68, y + CELL * 0.5);
      ctx.stroke();
    }
  }

  // A little pill label hovering over a board cell (good idea / brainrot wording).
  function drawCellLabel(cellX, cellY, text, color, alpha) {
    if (alpha <= 0) return;
    const cx = cellX * CELL + CELL / 2;
    let cy = cellY * CELL - CELL * 0.5; // hover just above the cell
    if (cellY <= 1) cy = cellY * CELL + CELL * 1.5; // near the top edge → show below instead
    cy = Math.max(16, Math.min(H - 16, cy));
    ctx.save();
    ctx.font = "700 12px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width;
    const half = w / 2 + 8;
    const ux = Math.max(half + 2, Math.min(W - half - 2, cx)); // keep the whole pill on-canvas
    roundRect(ux - w / 2 - 8, cy - 11, w + 16, 22, 7);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.9;
    ctx.fillStyle = "rgba(6,8,14,0.92)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = color;
    ctx.fillText(text, ux, cy);
    ctx.restore();
  }

  function drawPoopGlyphs() {
    if (!poops || !poops.length) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of poops) {
      const a = p.ttl > 900 ? 1 : Math.max(0, p.ttl / 900); // fade out at the end
      const age = p.life - p.ttl;
      const pop = age < 200 ? age / 200 : 1; // little pop-in when freshly dropped
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = Math.round(CELL * 0.58 * pop) + "px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
      ctx.fillText("💩", p.x * CELL + CELL / 2, p.y * CELL + CELL / 2 + 1);
      ctx.restore();
    }
  }

  function drawPoopLabels() {
    if (!poops || !poops.length) return;
    for (const p of poops) {
      if (p.labelTtl <= 0) continue;
      const a = p.labelTtl > 1600 ? 1 : p.labelTtl / 1600;
      drawCellLabel(p.x, p.y, p.phrase, C.pink, a);
    }
  }

  function drawFloats() {
    for (const f of floats) {
      const k = f.ttl / f.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, k));
      ctx.font = "700 13px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const yy = f.y - (1 - k) * 30;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(f.text, f.x + 1, yy + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, yy);
      ctx.restore();
    }
  }

  function draw() {
    drawBackground();
    drawPoopGlyphs(); // on the ground, beneath the worm so it's revealed as the tail moves off
    if (food) {
      drawPellet(food, C.cyan, food.idea.e, false);
      if (food.labelTtl > 0) {
        const a = food.labelTtl > 600 ? 1 : food.labelTtl / 600;
        drawCellLabel(food.x, food.y, food.idea.t, C.cyan, a);
      }
    }
    if (gold) drawPellet(gold, C.yellow, "🧠", true);
    if (snake) {
      drawBody();
      drawHead(snake[0], C.pink);
    }
    drawPoopLabels(); // brainrot wording, drawn above the worm so it stays readable
    drawFloats();

    if (paused && running) {
      ctx.fillStyle = "rgba(8,8,16,0.62)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.ink;
      ctx.font = "700 34px 'Bungee', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", W / 2, H / 2 - 8);
      ctx.font = "600 14px 'JetBrains Mono', monospace";
      ctx.fillStyle = C.dim;
      ctx.fillText("press P or tap Resume", W / 2, H / 2 + 26);
    }
  }

  // ---------- Simulation ----------
  function step() {
    // apply the next queued turn
    if (inputQ.length) dir = inputQ.shift();

    const head = snake[0];
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;

    // wall = death (no wrap — those are the boundaries of your attention span)
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return die("wall");
    // self = death (skip the tail cell, which is about to move out of the way)
    if (onSnake(nx, ny, true)) return die("self");

    const ateFood = food && nx === food.x && ny === food.y;
    const ateGold = gold && nx === gold.x && ny === gold.y;

    snake.unshift({ x: nx, y: ny });
    if (!ateFood && !ateGold) snake.pop(); // grow only when something was eaten

    if (ateFood) {
      playSfx("eat");
      eaten++;
      score += 10;
      const phrase = randomRot();
      const butt = snake[snake.length - 1]; // poop comes out the back end
      dropPoop(butt.x, butt.y, phrase);
      pushFeed(phrase);
      spawnFood();
      renderMenu();
      if (eaten % GOLD_EVERY === 0 && !gold) spawnGold();
      api.recordScore(GAME_ID, score);
      updateHud();
      saveProgress();
    } else if (ateGold) {
      playSfx("big");
      score += 75;
      const butt = snake[snake.length - 1];
      dropPoop(butt.x, butt.y, gold.phrase + " ✨");
      addFloat(nx, ny, "BIG BRAIN +75", C.yellow);
      pushFeed(gold.phrase + " (galaxy brained)");
      api.toast("🧠 Big Brain Idea! +75", "good");
      gold = null;
      api.recordScore(GAME_ID, score);
      updateHud();
      saveProgress();
    }
  }

  function die(cause) {
    playSfx("die");
    running = false;
    if (saveSlot) saveSlot.clear();
    const lenReached = snake.length;
    // settle floats + final frame
    draw();
    const isBest = score > 0 && score > bestAtStart && score >= api.getHighScore(GAME_ID);
    if (isBest) setTimeout(() => api.toast("🏆 New high score!", "good"), 250);
    showOverlay(
      cause === "wall" ? "Smooth Brain Splat." : "You Ate Your Own Brainrot.",
      cause === "wall"
        ? "You ran face-first into the edge of your attention span. Classic."
        : "You looped back and swallowed your own terrible takes. It happens to the best of us.",
      "Run it back",
      "Score: <strong>" + score.toLocaleString() +
        "</strong> · Brainrot length: <strong>" + lenReached +
        "</strong> · High: <strong>" + api.getHighScore(GAME_ID).toLocaleString() + "</strong>",
      newGame
    );
  }

  // ---------- Overlay ----------
  function showOverlay(title, sub, btnLabel, scoreHtml, onClick) {
    overlayTitle.innerHTML = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = scoreHtml || "";
    btnPrimary.textContent = btnLabel;
    btnPrimary.onclick = onClick;
    overlayEl.classList.add("overlay--show");
  }
  function hideOverlay() {
    overlayEl.classList.remove("overlay--show");
  }

  // ---------- Lifecycle ----------
  function newGame() {
    ensureAudio();
    playSfx("start");
    if (saveSlot) saveSlot.clear();
    snake = [];
    const sy = (ROWS / 2) | 0;
    const sx = 6;
    for (let i = 0; i < START_LEN; i++) snake.push({ x: sx - i, y: sy });
    dir = { x: 1, y: 0 };
    inputQ = [];
    floats = [];
    poops = [];
    feed = [];
    eaten = 0;
    score = 0;
    gold = null;
    started = true;
    running = true;
    paused = false;
    bestAtStart = api.getHighScore(GAME_ID);
    spawnFood();
    renderMenu();
    renderFeed();
    updateHud();
    setPauseLabel();
    hideOverlay();
    acc = 0;
    lastT = performance.now();
    saveProgress();
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    playSfx(paused ? "pause" : "resume");
    setPauseLabel();
    if (!paused) lastT = performance.now();
    draw();
    saveProgress();
  }

  function setPauseLabel() {
    if (btnPause) btnPause.textContent = paused ? "Resume" : "Pause";
  }

  // ---------- Main loop ----------
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    let dt = now - lastT;
    lastT = now;
    if (dt < 0) dt = 0;
    // Clamp big gaps (tab was backgrounded) so the worm never teleports to its death.
    if (dt > 250) dt = stepMs();

    if (running && !paused) {
      acc += dt;
      let safety = 0;
      const sm = stepMs();
      while (acc >= sm && safety < 4) {
        acc -= sm;
        safety++;
        step();
        if (!running) break;
      }
    }

    // time-based decay — only while actually playing, so a pause truly freezes everything
    if (running && !paused) {
      if (floats.length) {
        for (const f of floats) f.ttl -= dt;
        floats = floats.filter((f) => f.ttl > 0);
      }
      if (poops.length) {
        for (const p of poops) { p.ttl -= dt; p.labelTtl -= dt; }
        poops = poops.filter((p) => p.ttl > 0);
      }
      if (food && food.labelTtl > 0) food.labelTtl -= dt;
    }

    draw();
  }

  function snapshot() {
    return {
      snake: snake ? snake.map((cell) => ({ ...cell })) : [],
      dir: dir ? { ...dir } : { x: 1, y: 0 },
      inputQ: Array.isArray(inputQ) ? inputQ.map((next) => ({ ...next })) : [],
      food: food ? { ...food, idea: food.idea } : null,
      gold: gold ? { ...gold } : null,
      eaten,
      score,
      floats: floats ? floats.map((item) => ({ ...item })) : [],
      poops: poops ? poops.map((item) => ({ ...item })) : [],
      feed: Array.isArray(feed) ? feed.slice() : [],
      running,
      paused,
      started,
      acc,
    };
  }

  function saveProgress() {
    if (!saveSlot || !started || !running) return;
    saveSlot.save(snapshot());
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data || !Array.isArray(data.snake) || !data.snake.length) return;
    snake = data.snake.map((cell) => ({ x: Number(cell.x) || 0, y: Number(cell.y) || 0 }));
    dir = data.dir && Number.isFinite(data.dir.x) && Number.isFinite(data.dir.y) ? { x: data.dir.x, y: data.dir.y } : { x: 1, y: 0 };
    inputQ = Array.isArray(data.inputQ) ? data.inputQ.map((next) => ({ x: Number(next.x) || 0, y: Number(next.y) || 0 })).slice(0, 2) : [];
    food = data.food ? { ...data.food, idea: data.food.idea || SMART_IDEAS[0] } : null;
    gold = data.gold ? { ...data.gold } : null;
    eaten = Number(data.eaten) || 0;
    score = Number(data.score) || 0;
    floats = Array.isArray(data.floats) ? data.floats.map((item) => ({ ...item })) : [];
    poops = Array.isArray(data.poops) ? data.poops.map((item) => ({ ...item })) : [];
    feed = Array.isArray(data.feed) ? data.feed.slice(0, 6) : [];
    running = true;
    paused = Boolean(data.paused);
    started = true;
    acc = Number(data.acc) || 0;
    bestAtStart = api.getHighScore(GAME_ID);
    lastT = performance.now();
    renderMenu();
    renderFeed();
    updateHud();
    setPauseLabel();
    hideOverlay();
    draw();
  }

  // ---------- Input ----------
  const DIRS = {
    ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    W: { x: 0, y: -1 }, S: { x: 0, y: 1 }, A: { x: -1, y: 0 }, D: { x: 1, y: 0 },
  };

  function queueDir(nd) {
    if (!nd) return;
    const last = inputQ.length ? inputQ[inputQ.length - 1] : dir;
    if (nd.x === -last.x && nd.y === -last.y) return; // can't reverse onto yourself
    if (nd.x === last.x && nd.y === last.y) return; // already going that way
    if (inputQ.length < 2) {
      inputQ.push(nd);
      playSfx("turn");
    }
  }

  document.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "p" || e.key === "P") {
      if (running) { e.preventDefault(); togglePause(); }
      return;
    }
    if ((e.key === " " || e.key === "Enter") && !running) {
      e.preventDefault();
      newGame();
      return;
    }
    const nd = DIRS[e.key];
    if (!nd) return;
    e.preventDefault();
    if (running && !paused) queueDir(nd);
  });

  // mobile d-pad
  document.querySelectorAll("[data-mobile-dir]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const map = {
        up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
        left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
      };
      if (running && !paused) queueDir(map[btn.getAttribute("data-mobile-dir")]);
    });
  });

  if (btnNew) btnNew.addEventListener("click", newGame);
  if (btnPause) btnPause.addEventListener("click", togglePause);
  if (btnSound) btnSound.addEventListener("click", toggleSound);

  // swipe on the canvas
  let sx0 = 0, sy0 = 0, swiping = false;
  canvas.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    sx0 = t.clientX; sy0 = t.clientY; swiping = true;
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!swiping) return;
    swiping = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx0, dy = t.clientY - sy0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    if (Math.abs(dx) > Math.abs(dy)) queueDir(dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 });
    else queueDir(dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 });
  }, { passive: true });

  // ---------- Init ----------
  // Seed a static, non-running worm so the canvas isn't empty behind the overlay.
  snake = [];
  const iy = (ROWS / 2) | 0;
  for (let i = 0; i < START_LEN; i++) snake.push({ x: 6 - i, y: iy });
  dir = { x: 1, y: 0 };
  inputQ = [];
  floats = [];
  poops = [];
  feed = [];
  eaten = 0;
  best = api.getHighScore(GAME_ID);
  spawnFood();
  renderMenu();
  renderFeed();
  updateHud();
  setSoundLabel();
  btnPrimary.onclick = newGame;
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
  if (saveSlot) {
    saveMenu = saveSlot.attachButtons({
      primary: btnPrimary,
      scoreEl: overlayScore,
      continueLabel: "Continue",
      newLabel: "New game",
      onContinue: restoreGame,
      summary: (saved) => {
        const data = saved.data || {};
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Score <strong>${Number(data.score || 0).toLocaleString()}</strong> · Length <strong>${(data.snake || []).length || START_LEN}</strong>`;
      },
    });
    saveSlot.startAutosave(snapshot, () => running && started);
    saveMenu.refresh();
  }

  // ---------- Debug hook ----------
  window.__SNACK = {
    start: newGame,
    pause: togglePause,
    step,
    dir: (name) => queueDir({ up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[name]),
    spawnGold,
    grow: (n) => { for (let i = 0; i < (n || 1); i++) snake.push({ ...snake[snake.length - 1] }); updateHud(); },
    get score() { return score; },
    get length() { return snake.length; },
    get heading() { return dir; },
    get running() { return running; },
    get paused() { return paused; },
    get snake() { return snake.map((s) => ({ ...s })); },
    get food() { return food; },
    get gold() { return gold; },
    get poops() { return poops.map((p) => ({ ...p })); },
    get feed() { return feed.slice(); },
    save: saveProgress,
    restore: () => restoreGame(saveSlot && saveSlot.read()),
  };
})();
