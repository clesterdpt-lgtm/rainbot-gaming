/* ============================================
   COMPLAINT CHAIN - bubble-drop merge game
   - Canvas bubble physics with generated character art
   - Debug hook: window.__KAREN_MERGER
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "karen-merger";
  const W = 720;
  const H = 860;
  const WALL = 28;
  const FLOOR = H - 34;
  const ROOF = 92;
  const DANGER_Y = 176;
  const MAX = 10;
  const GRAVITY = 1500;
  const FRICTION = 0.992;
  const RESTITUTION = 0.28;
  const MERGE_COOLDOWN = 0.18;
  const DROP_COOLDOWN = 0.52;
  const MANAGER_METER_MAX = 100;
  const MANAGER_FILL_SCALE = 0.3;
  const MANAGER_ABILITIES = ["clear", "merge", "pill"];
  const MANAGER_WILD_RADIUS = 36;
  const MANAGER_PILL_RADIUS = 46;
  const RECEIPT_COST = 80;
  const HOA_COST = 65;
  const scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  const sheetUrl = new URL("../img/karen-merger/karen-merger-sheet.png", scriptUrl).href;

  const TIERS = [
    null,
    { name: "Tiny Complaint", color: "#ff2e88", col: 0, row: 0, radius: 32 },
    { name: "Coupon Clutch", color: "#ffd43b", col: 1, row: 0, radius: 37 },
    { name: "Manager Demand", color: "#2ee0ff", col: 2, row: 0, radius: 42 },
    { name: "HOA Notice", color: "#ff5dbc", col: 3, row: 0, radius: 48 },
    { name: "Livestream Rant", color: "#35efff", col: 4, row: 0, radius: 55 },
    { name: "Gate Meltdown", color: "#a45cff", col: 0, row: 1, radius: 63 },
    { name: "Corporate Call", color: "#18d5d7", col: 1, row: 1, radius: 72 },
    { name: "Manager Summoner", color: "#ffd43b", col: 2, row: 1, radius: 82 },
    { name: "Class Action Queen", color: "#ff2e88", col: 3, row: 1, radius: 94 },
    { name: "Consumer Rights Kaiju", color: "#ff2e88", col: 4, row: 1, radius: 110 },
  ];

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  const boardEl = document.getElementById("board");
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnNew = document.getElementById("btn-new");
  const btnDrop = document.getElementById("btn-drop");
  const btnAimLeft = document.getElementById("btn-aim-left");
  const btnAimRight = document.getElementById("btn-aim-right");
  const btnManager = document.getElementById("btn-manager");
  const btnReceipt = document.getElementById("btn-receipt");
  const btnHoa = document.getElementById("btn-hoa");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const btnSound = document.getElementById("btn-sound");
  const scoreEl = document.getElementById("hud-score");
  const energyEl = document.getElementById("hud-energy");
  const topEl = document.getElementById("hud-top");
  const heatEl = document.getElementById("hud-heat");
  const bestEl = document.getElementById("hud-best");
  const heatFill = document.getElementById("heat-fill");
  const heatLabel = document.getElementById("heat-label");
  const managerFill = document.getElementById("manager-fill");
  const managerLabel = document.getElementById("manager-label");
  const shakeFill = document.getElementById("shake-fill");
  const shakeLabel = document.getElementById("shake-label");
  const nextPreview = document.getElementById("next-preview");
  const nextName = document.getElementById("next-name");
  const logEl = document.getElementById("log");
  const ladderEl = document.getElementById("ladder");

  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 2 });
  const sheet = new Image();
  sheet.src = sheetUrl;

  let bubbles = [];
  let managerTokens = [];
  let pops = [];
  let coupons = [];
  let score = 0;
  let energy = 35;
  let heat = 0;
  let managerMeter = 0;
  let managerAbility = null;
  let topTier = 1;
  let aimX = W / 2;
  let nextTier = 1;
  let uid = 0;
  let running = false;
  let won = false;
  let pausedByOverlay = true;
  let lastDropAt = -10;
  let lastFrame = 0;
  let dangerTime = 0;
  let shake = 0;
  let managerFlash = 0;
  let bestAtStart = 0;
  let saveMenu = null;
  const SOUND_PREF_KEY = GAME_ID + ":sound";
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let audioMaster = null;
  let soundOn = readSoundPreference();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
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

  function updateSoundButton() {
    if (!btnSound) return;
    if (!AudioContextCtor) {
      btnSound.textContent = "Sound Off";
      btnSound.setAttribute("aria-pressed", "false");
      btnSound.disabled = true;
      return;
    }
    btnSound.textContent = soundOn ? "Sound On" : "Sound Off";
    btnSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  }

  function ensureAudio() {
    if (!soundOn || !AudioContextCtor) return null;
    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
      audioMaster = audioCtx.createGain();
      audioMaster.gain.value = 0.11;
      audioMaster.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (audioMaster) audioMaster.gain.setTargetAtTime(0.11, audioCtx.currentTime, 0.03);
    return audioCtx;
  }

  function playTone(freq, duration, options = {}) {
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + (options.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const attack = Math.min(options.attack || 0.012, duration * 0.45);
    osc.type = options.type || "sine";
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (options.to) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), t0 + duration);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(options.gain || 0.035, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(audioMaster || ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.04);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  function playNoise(duration, options = {}) {
    const ac = ensureAudio();
    if (!ac) return;
    const length = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const t0 = ac.currentTime + (options.delay || 0);
    const source = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    source.buffer = buffer;
    filter.type = options.filter || "bandpass";
    filter.frequency.setValueAtTime(options.frequency || 900, t0);
    filter.Q.value = options.q || 0.8;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(options.gain || 0.026, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioMaster || ac.destination);
    source.start(t0);
    source.stop(t0 + duration + 0.04);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  function playSfx(name, detail = {}) {
    if (!soundOn) return;
    const tier = clamp(Number(detail.tier) || 1, 1, MAX);
    const base = 240 + tier * 26;

    if (name === "start") {
      playTone(196, 0.08, { type: "triangle", to: 294, gain: 0.036 });
      playTone(392, 0.12, { type: "triangle", to: 523, gain: 0.03, delay: 0.07 });
    } else if (name === "drop") {
      playTone(260, 0.07, { type: "triangle", to: 145, gain: 0.032 });
      playNoise(0.035, { frequency: 1400, gain: 0.012, delay: 0.025 });
    } else if (name === "merge") {
      playTone(base, 0.075, { type: "triangle", to: base * 1.35, gain: 0.038 });
      playTone(base * 1.55, 0.11, { type: "sine", to: base * 1.95, gain: 0.025, delay: 0.052 });
      playNoise(0.055, { frequency: 1800, gain: 0.014, delay: 0.018 });
    } else if (name === "managerReady") {
      playTone(base, 0.07, { type: "triangle", to: base * 1.45, gain: 0.034 });
      playTone(740, 0.12, { type: "square", to: 980, gain: 0.024, delay: 0.08 });
      playTone(1180, 0.16, { type: "sine", gain: 0.02, delay: 0.16 });
    } else if (name === "manager") {
      playTone(210, 0.22, { type: "sawtooth", to: 840, gain: 0.045 });
      playTone(520, 0.24, { type: "triangle", to: 260, gain: 0.032, delay: 0.06 });
      playNoise(0.28, { frequency: 680, gain: 0.035, delay: 0.02 });
    } else if (name === "wildcard") {
      playTone(440, 0.08, { type: "triangle", to: 660, gain: 0.034 });
      playTone(880, 0.12, { type: "sine", to: 1320, gain: 0.024, delay: 0.06 });
      playNoise(0.1, { frequency: 2100, gain: 0.014, delay: 0.03 });
    } else if (name === "pill") {
      playTone(98, 0.18, { type: "sawtooth", to: 150, gain: 0.052 });
      playTone(260, 0.12, { type: "square", to: 180, gain: 0.028, delay: 0.08 });
      playNoise(0.24, { frequency: 360, gain: 0.034, delay: 0.02 });
    } else if (name === "receipt") {
      [840, 1180, 1460].forEach((freq, index) =>
        playTone(freq, 0.045, { type: "square", gain: 0.022, delay: index * 0.055 })
      );
      playNoise(0.12, { frequency: 2200, gain: 0.018, delay: 0.02 });
    } else if (name === "hoa") {
      playTone(150, 0.16, { type: "sawtooth", to: 78, gain: 0.05 });
      playTone(340, 0.08, { type: "square", to: 220, gain: 0.022, delay: 0.06 });
      playNoise(0.16, { frequency: 420, gain: 0.03 });
    } else if (name === "win") {
      [330, 494, 660, 990].forEach((freq, index) =>
        playTone(freq, 0.14, { type: "triangle", gain: 0.034, delay: index * 0.085 })
      );
      playNoise(0.28, { frequency: 2600, gain: 0.018, delay: 0.18 });
    } else if (name === "gameOver") {
      playTone(220, 0.18, { type: "sawtooth", to: 130, gain: 0.045 });
      playTone(120, 0.28, { type: "sawtooth", to: 50, gain: 0.038, delay: 0.12 });
      playNoise(0.22, { frequency: 300, gain: 0.025, delay: 0.05 });
    } else if (name === "nope") {
      playTone(160, 0.08, { type: "square", to: 105, gain: 0.025 });
    } else if (name === "toggle") {
      playTone(440, 0.07, { type: "triangle", gain: 0.026 });
      playTone(660, 0.08, { type: "triangle", gain: 0.022, delay: 0.055 });
    }
  }

  function toggleSound() {
    if (!AudioContextCtor) return;
    soundOn = !soundOn;
    writeSoundPreference();
    updateSoundButton();
    if (soundOn) {
      ensureAudio();
      playSfx("toggle");
    } else if (audioCtx && audioMaster) {
      audioMaster.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.025);
    }
  }

  function tierScore(tier) {
    return Math.round(Math.pow(1.78, tier) * 35);
  }

  function tierEnergy(tier) {
    return 7 + tier * 5;
  }

  function managerChargeFor(tier) {
    return Math.max(3, Math.round((8 + tier * 3) * MANAGER_FILL_SCALE));
  }

  function managerAbilityLabel(ability) {
    if (ability === "clear") return "Clear";
    if (ability === "merge") return "Merge";
    if (ability === "pill") return "Big Pill";
    return "Manager";
  }

  function managerAbilityPool() {
    if (!bubbles.length) return [];
    const pool = MANAGER_ABILITIES.filter((ability) => ability !== "merge");
    if (bubbles.some((bubble) => bubble.tier < MAX)) pool.push("merge");
    return pool;
  }

  function managerAbilityIsValid(ability) {
    if (!ability || !bubbles.length) return false;
    if (ability === "merge") return bubbles.some((bubble) => bubble.tier < MAX);
    return MANAGER_ABILITIES.includes(ability);
  }

  function rollManagerAbility() {
    const pool = managerAbilityPool();
    managerAbility = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
    return managerAbility;
  }

  function ensureManagerAbility() {
    if (managerMeter < MANAGER_METER_MAX) {
      managerAbility = null;
      return null;
    }
    if (!managerAbilityIsValid(managerAbility)) rollManagerAbility();
    return managerAbility;
  }

  function randomNextTier() {
    const ceiling = Math.max(2, Math.min(5, topTier - 1));
    if (Math.random() < 0.72) return 1;
    if (Math.random() < 0.72) return 2;
    return clamp(1 + ((Math.random() * ceiling) | 0), 1, ceiling);
  }

  function cellRect(tier) {
    const cellW = sheet.naturalWidth / 5;
    const cellH = sheet.naturalHeight / 2;
    return {
      x: tier.col * cellW,
      y: tier.row * cellH,
      w: cellW,
      h: cellH,
    };
  }

  function log(message) {
    if (logEl) logEl.textContent = message;
  }

  function chargeManager(tier) {
    const wasReady = managerMeter >= MANAGER_METER_MAX;
    managerMeter = clamp(managerMeter + managerChargeFor(tier), 0, MANAGER_METER_MAX);
    const readyNow = !wasReady && managerMeter >= MANAGER_METER_MAX;
    if (readyNow) {
      const ability = ensureManagerAbility();
      if (ability && api.toast) api.toast("Manager drew: " + managerAbilityLabel(ability), "good");
    }
    return readyNow;
  }

  function makeBubble(tier, x, y, opts = {}) {
    const def = TIERS[tier];
    return {
      id: ++uid,
      tier,
      x,
      y,
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      r: def.radius,
      mergedAt: -10,
      fresh: opts.fresh ? 0.2 : 0,
    };
  }

  function makeManagerToken(kind) {
    const r = kind === "pill" ? MANAGER_PILL_RADIUS : MANAGER_WILD_RADIUS;
    return {
      id: ++uid,
      kind,
      x: clamp(aimX, WALL + r, W - WALL - r),
      y: ROOF - r - 16,
      vx: kind === "pill" ? rand(-30, 30) : 0,
      vy: kind === "pill" ? 250 : 150,
      r,
      rot: kind === "pill" ? rand(-0.18, 0.18) : 0,
      spin: kind === "pill" ? rand(-1.3, 1.3) : rand(-2.5, 2.5),
      life: kind === "pill" ? 3.8 : 4.4,
      hits: 0,
    };
  }

  function updatePreview() {
    const tier = TIERS[nextTier];
    if (nextName) nextName.textContent = tier.name;
    if (nextPreview) {
      nextPreview.style.setProperty("--bubble-color", tier.color);
      nextPreview.style.setProperty("--sheet", 'url("' + sheetUrl + '")');
      nextPreview.style.setProperty("--sheet-pos", tier.col * 25 + "% " + tier.row * 100 + "%");
    }
  }

  function makeLadder() {
    if (!ladderEl) return;
    ladderEl.innerHTML = "";
    for (let i = 1; i <= MAX; i++) {
      const tier = TIERS[i];
      const li = document.createElement("li");
      li.innerHTML =
        '<span class="karen-ladder__bubble" aria-hidden="true"></span>' +
        "<span>" + tier.name + "</span>";
      const thumb = li.querySelector(".karen-ladder__bubble");
      thumb.style.setProperty("--bubble-color", tier.color);
      thumb.style.setProperty("--sheet", 'url("' + sheetUrl + '")');
      thumb.style.setProperty("--sheet-pos", tier.col * 25 + "% " + tier.row * 100 + "%");
      ladderEl.appendChild(li);
    }
  }

  function drawBubble(bubble, alpha = 1) {
    const tier = TIERS[bubble.tier];
    const r = bubble.r;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(bubble.x, bubble.y);

    const glow = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.2, 0, 0, r * 1.15);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.2, tier.color + "ee");
    glow.addColorStop(1, "rgba(0,0,0,0.74)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
    ctx.clip();
    if (sheet.complete && sheet.naturalWidth > 0) {
      const src = cellRect(tier);
      ctx.drawImage(sheet, src.x, src.y, src.w, src.h, -r, -r, r * 2, r * 2);
    } else {
      ctx.fillStyle = tier.color;
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.4, r * 0.32, r * 0.16, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = Math.max(3, r * 0.08);
    ctx.strokeStyle = tier.color;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.arc(0, 0, r - 6, Math.PI * 1.15, Math.PI * 1.62);
    ctx.stroke();

    ctx.restore();
  }

  function capsulePath(x, y, w, h) {
    const rr = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
  }

  function drawWildcardToken(token) {
    const r = token.r;
    ctx.save();
    ctx.translate(token.x, token.y);
    ctx.rotate(token.rot);

    const glow = ctx.createRadialGradient(-r * 0.18, -r * 0.18, r * 0.18, 0, 0, r * 1.25);
    glow.addColorStop(0, "rgba(255,255,255,0.98)");
    glow.addColorStop(0.32, "rgba(46,224,255,0.88)");
    glow.addColorStop(1, "rgba(255,46,136,0.2)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(7, 9, 22, 0.88)";
    ctx.strokeStyle = "#2ee0ff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 212, 59, 0.9)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, r - 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ffd43b";
    ctx.font = "900 " + Math.round(r * 0.48) + "px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ANY", 0, -2);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "800 " + Math.round(r * 0.18) + "px JetBrains Mono, monospace";
    ctx.fillText("MERGE", 0, r * 0.42);
    ctx.restore();
  }

  function drawPillToken(token) {
    const r = token.r;
    const w = r * 2.35;
    const h = r * 0.92;
    ctx.save();
    ctx.translate(token.x, token.y);
    ctx.rotate(token.rot);
    ctx.shadowColor = "rgba(255, 212, 59, 0.48)";
    ctx.shadowBlur = 18;

    ctx.save();
    capsulePath(-w / 2, -h / 2, w, h);
    ctx.clip();
    ctx.fillStyle = "#fff8e8";
    ctx.fillRect(-w / 2, -h / 2, w / 2, h);
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(0, -h / 2, w / 2, h);
    ctx.fillStyle = "rgba(46,224,255,0.22)";
    ctx.fillRect(-w / 2, -h / 2, w, h * 0.34);
    ctx.restore();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(5, 7, 13, 0.88)";
    ctx.lineWidth = 5;
    capsulePath(-w / 2, -h / 2, w, h);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    capsulePath(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
    ctx.stroke();

    ctx.fillStyle = "#070916";
    ctx.font = "900 " + Math.round(r * 0.2) + "px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BIG PILL", 0, 1);
    ctx.restore();
  }

  function drawManagerTokens() {
    for (const token of managerTokens) {
      if (token.kind === "pill") drawPillToken(token);
      else drawWildcardToken(token);
    }
  }

  function drawBackground() {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#121022");
    bg.addColorStop(0.45, "#19122a");
    bg.addColorStop(1, "#061827");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = "rgba(46,224,255,0.18)";
    ctx.lineWidth = 1;
    for (let x = WALL; x < W - WALL; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, ROOF);
      ctx.lineTo(x, FLOOR);
      ctx.stroke();
    }
    for (let y = ROOF; y < FLOOR; y += 48) {
      ctx.beginPath();
      ctx.moveTo(WALL, y);
      ctx.lineTo(W - WALL, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,46,136,0.08)";
    ctx.fillRect(WALL, ROOF, W - WALL * 2, FLOOR - ROOF);

    ctx.strokeStyle = "rgba(255,46,136,0.8)";
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(WALL + 8, DANGER_Y);
    ctx.lineTo(W - WALL - 8, DANGER_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255,255,255,0.58)";
    ctx.font = "800 13px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText("ESCALATION LINE", W - WALL - 12, DANGER_Y - 12);

    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(WALL, ROOF);
    ctx.lineTo(WALL, FLOOR);
    ctx.lineTo(W - WALL, FLOOR);
    ctx.lineTo(W - WALL, ROOF);
    ctx.stroke();
  }

  function drawAim() {
    if (!running || pausedByOverlay) return;
    const tier = TIERS[nextTier];
    const ghost = { tier: nextTier, x: aimX, y: 62, r: tier.radius };
    ctx.save();
    ctx.strokeStyle = "rgba(255,212,59,0.8)";
    ctx.setLineDash([10, 12]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(aimX, 36);
    ctx.lineTo(aimX, FLOOR - 24);
    ctx.stroke();
    ctx.setLineDash([]);
    drawBubble(ghost, 0.64);
    ctx.restore();
  }

  function drawPops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const pop = pops[i];
      pop.life -= dt;
      if (pop.life <= 0) {
        pops.splice(i, 1);
        continue;
      }
      const t = 1 - pop.life / pop.max;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = pop.color;
      ctx.lineWidth = 5 * (1 - t);
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, pop.r + t * 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function spawnCouponStorm(count, x = W / 2, y = ROOF + 24) {
    const labels = ["VOID", "COUPON", "NEXT", "-5%", "NOPE", "MANAGER"];
    const colors = ["#ffd43b", "#ff2e88", "#2ee0ff", "#ffffff"];
    for (let i = 0; i < count; i++) {
      const life = rand(0.85, 1.45);
      coupons.push({
        x: x + rand(-190, 190),
        y: y + rand(-26, 52),
        vx: rand(-190, 190),
        vy: rand(-420, -150),
        rot: rand(-0.7, 0.7),
        spin: rand(-7, 7),
        life,
        max: life,
        label: labels[(Math.random() * labels.length) | 0],
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  function drawCoupons(dt) {
    for (let i = coupons.length - 1; i >= 0; i--) {
      const coupon = coupons[i];
      coupon.life -= dt;
      if (coupon.life <= 0) {
        coupons.splice(i, 1);
        continue;
      }
      coupon.vy += 620 * dt;
      coupon.x += coupon.vx * dt;
      coupon.y += coupon.vy * dt;
      coupon.rot += coupon.spin * dt;
      const alpha = clamp(coupon.life / coupon.max, 0, 1);

      ctx.save();
      ctx.translate(coupon.x, coupon.y);
      ctx.rotate(coupon.rot);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = coupon.color;
      ctx.strokeStyle = "rgba(5, 7, 13, 0.78)";
      ctx.lineWidth = 2;
      ctx.fillRect(-34, -12, 68, 24);
      ctx.strokeRect(-34, -12, 68, 24);
      ctx.fillStyle = "#070916";
      ctx.font = "900 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(coupon.label, 0, 1);
      ctx.restore();
    }
  }

  function drawManagerFlash() {
    if (managerFlash <= 0) return;
    const alpha = clamp(managerFlash / 0.7, 0, 1);
    ctx.save();
    ctx.fillStyle = "rgba(255, 212, 59, " + 0.14 * alpha + ")";
    ctx.fillRect(WALL, ROOF, W - WALL * 2, FLOOR - ROOF);
    ctx.fillStyle = "rgba(255, 255, 255, " + 0.88 * alpha + ")";
    ctx.strokeStyle = "rgba(5, 7, 13, " + 0.8 * alpha + ")";
    ctx.lineWidth = 5;
    ctx.font = "900 34px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.strokeText("MANAGER SUMMONED", W / 2, ROOF + 24);
    ctx.fillText("MANAGER SUMMONED", W / 2, ROOF + 24);
    ctx.restore();
  }

  function render(dt) {
    drawBackground();
    const wobble = shake > 0 ? Math.sin(performance.now() * 0.05) * shake : 0;
    ctx.save();
    ctx.translate(wobble, 0);
    drawAim();
    for (const bubble of bubbles) drawBubble(bubble);
    drawManagerTokens();
    drawPops(dt);
    drawCoupons(dt);
    ctx.restore();
    drawManagerFlash();
    shake = Math.max(0, shake - dt * 6);
    managerFlash = Math.max(0, managerFlash - dt);
  }

  function resolveWalls(b) {
    if (b.x - b.r < WALL) {
      b.x = WALL + b.r;
      b.vx = Math.abs(b.vx) * RESTITUTION;
    }
    if (b.x + b.r > W - WALL) {
      b.x = W - WALL - b.r;
      b.vx = -Math.abs(b.vx) * RESTITUTION;
    }
    if (b.y + b.r > FLOOR) {
      b.y = FLOOR - b.r;
      b.vy = -Math.abs(b.vy) * RESTITUTION;
      b.vx *= 0.95;
      if (Math.abs(b.vy) < 45) b.vy = 0;
    }
    if (b.y - b.r < 24) {
      b.y = 24 + b.r;
      b.vy = Math.abs(b.vy) * 0.2;
    }
  }

  function resolvePair(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const min = a.r + b.r;
    if (dist >= min) return;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = min - dist;
    const total = a.r + b.r;
    const aw = b.r / total;
    const bw = a.r / total;
    a.x -= nx * overlap * aw;
    a.y -= ny * overlap * aw;
    b.x += nx * overlap * bw;
    b.y += ny * overlap * bw;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const sep = rvx * nx + rvy * ny;
    if (sep < 0) {
      const impulse = -(1 + 0.15) * sep / 2;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
    }
  }

  function canMerge(a, b, now) {
    if (a.tier !== b.tier || a.tier >= MAX) return false;
    if (now - a.mergedAt < MERGE_COOLDOWN || now - b.mergedAt < MERGE_COOLDOWN) return false;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    return dist <= (a.r + b.r) * 1.04;
  }

  function awardWildcardMerge(target, now) {
    if (target.tier >= MAX) {
      pops.push({ x: target.x, y: target.y, r: target.r, color: "#ffd43b", life: 0.4, max: 0.4 });
      playSfx("nope");
      log("Wildcard merge bounced off the final form. Corporate has no form for that.");
      return;
    }

    const tier = target.tier + 1;
    const merged = makeBubble(tier, target.x, target.y, {
      vx: target.vx * 0.25,
      vy: Math.min(target.vy * 0.12, 0) - 150,
      fresh: true,
    });
    merged.mergedAt = now;
    bubbles = bubbles.filter((item) => item !== target);
    bubbles.push(merged);
    pops.push({ x: merged.x, y: merged.y, r: merged.r, color: TIERS[tier].color, life: 0.55, max: 0.55 });
    spawnCouponStorm(8, merged.x, merged.y);
    score += tierScore(tier);
    energy += Math.ceil(tierEnergy(tier) * 0.7);
    heat = clamp(heat + tier * 1.2 - 5, 0, 100);
    topTier = Math.max(topTier, tier);
    api.recordScore(GAME_ID, score);
    playSfx("merge", { tier });
    if (tier >= MAX && !won) showWin();
    log("Wildcard merge tagged " + TIERS[target.tier].name + " into " + TIERS[tier].name + ".");
    saveProgress();
  }

  function resolvePillCollision(token, bubble) {
    const dx = bubble.x - token.x;
    const dy = bubble.y - token.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const min = token.r * 0.84 + bubble.r;
    if (dist >= min) return false;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = min - dist;
    bubble.x += nx * overlap * 1.12;
    bubble.y += ny * overlap * 1.12;
    bubble.vx += nx * (380 + Math.abs(token.vy) * 0.22) + token.vx * 0.2;
    bubble.vy += ny * (300 + Math.abs(token.vy) * 0.14) + Math.max(0, token.vy) * 0.1;
    token.vx -= nx * 28;
    token.vy *= 0.992;
    token.spin += nx * 0.55;
    resolveWalls(bubble);
    return true;
  }

  function updateManagerTokens(dt, now) {
    for (let i = managerTokens.length - 1; i >= 0; i--) {
      const token = managerTokens[i];
      token.life -= dt;
      token.vy += GRAVITY * (token.kind === "pill" ? 1.25 : 0.95) * dt;
      token.x += token.vx * dt;
      token.y += token.vy * dt;
      token.vx *= token.kind === "pill" ? 0.996 : 0.992;
      token.rot += token.spin * dt;

      if (token.x - token.r < WALL) {
        token.x = WALL + token.r;
        token.vx = Math.abs(token.vx) * 0.65;
      }
      if (token.x + token.r > W - WALL) {
        token.x = W - WALL - token.r;
        token.vx = -Math.abs(token.vx) * 0.65;
      }

      if (token.kind === "wild") {
        const hit = bubbles.find((bubble) => Math.hypot(bubble.x - token.x, bubble.y - token.y) <= bubble.r + token.r * 0.86);
        if (hit) {
          managerTokens.splice(i, 1);
          awardWildcardMerge(hit, now);
          continue;
        }
        if (token.y - token.r > FLOOR + 70 || token.life <= 0) {
          managerTokens.splice(i, 1);
          playSfx("nope");
          log("Wildcard merge missed. Somewhere, a coupon lawyer smiled.");
        }
      } else {
        let hitCount = 0;
        for (const bubble of bubbles) {
          if (resolvePillCollision(token, bubble)) hitCount++;
        }
        token.hits += hitCount;
        if (hitCount) {
          shake = Math.max(shake, clamp(hitCount * 1.4, 2, 8));
        }
        if (token.y - token.r > FLOOR + 140 || token.life <= 0) {
          managerTokens.splice(i, 1);
          log(token.hits ? "The Big Pill finished its prescription." : "The Big Pill hit absolutely nothing. Powerful placebo.");
        }
      }
    }
  }

  function mergeBubbles(a, b, now) {
    const tier = a.tier + 1;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const vx = (a.vx + b.vx) * 0.18;
    const vy = Math.min((a.vy + b.vy) * 0.1, 0) - 40;
    bubbles = bubbles.filter((item) => item !== a && item !== b);
    const merged = makeBubble(tier, x, y, { vx, vy, fresh: true });
    merged.mergedAt = now;
    bubbles.push(merged);
    pops.push({ x, y, r: merged.r, color: TIERS[tier].color, life: 0.45, max: 0.45 });
    score += tierScore(tier);
    energy += tierEnergy(tier);
    const managerReadyNow = chargeManager(tier);
    playSfx(managerReadyNow ? "managerReady" : "merge", { tier });
    heat = clamp(heat + tier * 2.2 - 5, 0, 100);
    topTier = Math.max(topTier, tier);
    api.recordScore(GAME_ID, score);
    if (tier >= MAX && !won) showWin();
    log(
      TIERS[tier].name + " bubble merged." +
        (managerReadyNow && managerAbility ? " Manager drew " + managerAbilityLabel(managerAbility) + "." : "")
    );
  }

  function stepPhysics(dt, now) {
    if (!running || pausedByOverlay) return;

    for (const b of bubbles) {
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      if (b.fresh > 0) b.fresh -= dt;
      resolveWalls(b);
    }

    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < bubbles.length; i++) {
        for (let j = i + 1; j < bubbles.length; j++) {
          resolvePair(bubbles[i], bubbles[j]);
        }
      }
      for (const b of bubbles) resolveWalls(b);
    }

    updateManagerTokens(dt, now);

    const mergeQueue = [];
    const used = new Set();
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i];
        const b = bubbles[j];
        if (used.has(a) || used.has(b)) continue;
        if (canMerge(a, b, now)) {
          mergeQueue.push([a, b]);
          used.add(a);
          used.add(b);
        }
      }
    }

    for (const [a, b] of mergeQueue) mergeBubbles(a, b, now);

    const top = bubbles.reduce((min, b) => Math.min(min, b.y - b.r), FLOOR);
    const pressure = clamp((DANGER_Y + 24 - top) / 180, 0, 1);
    heat = clamp(heat * 0.998 + pressure * 0.34 + Math.max(0, bubbles.length - 12) * 0.01, 0, 100);
    if (top < DANGER_Y && bubbles.length > 7) dangerTime += dt;
    else dangerTime = Math.max(0, dangerTime - dt * 1.8);

    if (dangerTime > 2.25) showGameOver();
    updateHud();
  }

  function frame(time) {
    const now = time / 1000;
    const dt = Math.min(0.033, lastFrame ? now - lastFrame : 0.016);
    lastFrame = now;
    stepPhysics(dt, now);
    render(dt);
    requestAnimationFrame(frame);
  }

  function dropBubble() {
    if (!running || pausedByOverlay) return false;
    const now = performance.now() / 1000;
    if (now - lastDropAt < DROP_COOLDOWN) return false;
    const tier = nextTier;
    const r = TIERS[tier].radius;
    const bubble = makeBubble(tier, clamp(aimX, WALL + r, W - WALL - r), 64, {
      vy: 90,
      fresh: true,
    });
    bubbles.push(bubble);
    nextTier = randomNextTier();
    lastDropAt = now;
    heat = clamp(heat + 2.5, 0, 100);
    updatePreview();
    saveProgress();
    playSfx("drop", { tier });
    return true;
  }

  function aim(delta) {
    aimX = clamp(aimX + delta, WALL + 34, W - WALL - 34);
  }

  function screenToCanvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isMaxed() {
    return Boolean(boardEl && boardEl.classList.contains("is-maxed"));
  }

  function updateFullscreenButton(on) {
    if (!btnFullscreen) return;
    btnFullscreen.textContent = on ? "Min" : "\u26f6";
    btnFullscreen.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
    btnFullscreen.title = on ? "Exit max screen" : "Max screen";
  }

  function setMaxed(on) {
    if (!boardEl) return;
    boardEl.classList.toggle("is-maxed", on);
    document.body.classList.toggle("rb-game-maxed", on);
    updateFullscreenButton(on);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      render(0);
    });
  }

  async function toggleMaxed() {
    if (!boardEl) return;
    const next = !isMaxed();
    setMaxed(next);

    try {
      if (next) {
        const request = boardEl.requestFullscreen || boardEl.webkitRequestFullscreen;
        if (request) await request.call(boardEl);
      } else if (fullscreenElement()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      }
    } catch (_) {
      // The fixed-position maxed class is the reliable layout path; native fullscreen is best-effort.
    }
  }

  function syncFullscreenState() {
    if (!fullscreenElement() && isMaxed()) setMaxed(false);
  }

  function canSpendManagerMeter() {
    if (!running || pausedByOverlay) return;
    if (managerMeter < MANAGER_METER_MAX) {
      playSfx("nope");
      log("Chain more merges before asking for the manager.");
      return false;
    }
    return true;
  }

  function spendManagerMeter() {
    managerMeter = 0;
    managerAbility = null;
    managerFlash = Math.max(managerFlash, 0.35);
  }

  function useManager() {
    if (!canSpendManagerMeter()) return;
    const ability = ensureManagerAbility();
    if (ability === "clear") {
      useManagerClear();
    } else if (ability === "merge") {
      useManagerMerge();
    } else if (ability === "pill") {
      useManagerPill();
    } else {
      playSfx("nope");
      log("The manager wandered off before choosing an ability.");
    }
  }

  function useManagerClear() {
    if (!canSpendManagerMeter()) return;
    if (!bubbles.length) {
      playSfx("nope");
      log("The aisle is already clear enough to avoid eye contact.");
      return;
    }

    spendManagerMeter();
    let targets = bubbles
      .filter((b) => b.tier <= 2)
      .sort((a, b) => (a.y - a.r) - (b.y - b.r));

    if (!targets.length) {
      targets = bubbles
        .slice()
        .sort((a, b) => a.tier - b.tier || (a.y - a.r) - (b.y - b.r));
    }

    targets = targets.slice(0, Math.min(8, targets.length));
    const cleared = new Set(targets);
    bubbles = bubbles.filter((b) => !cleared.has(b));
    for (const target of targets) {
      pops.push({ x: target.x, y: target.y, r: target.r, color: "#ffd43b", life: 0.6, max: 0.6 });
    }
    for (const b of bubbles) {
      b.vy -= 150;
      b.vx += (b.x < W / 2 ? -1 : 1) * rand(34, 92);
    }
    heat = clamp(heat - 30 - targets.length * 2, 0, 100);
    dangerTime = 0;
    shake = 8;
    managerFlash = 0.7;
    spawnCouponStorm(18 + targets.length * 4);
    playSfx("manager");
    log("Random manager ability: Clear. " + targets.length + " low-tier complaint" + (targets.length === 1 ? "" : "s") + " escorted out.");
    updateHud();
    saveProgress();
  }

  function useManagerMerge() {
    if (!canSpendManagerMeter()) return;
    if (!bubbles.some((bubble) => bubble.tier < MAX)) {
      playSfx("nope");
      log("Wildcard merge needs a bubble that can still escalate.");
      return;
    }

    spendManagerMeter();
    const token = makeManagerToken("wild");
    managerTokens.push(token);
    playSfx("wildcard");
    log("Random manager ability: Merge. The wildcard will fuse with the first bubble it hits.");
    updateHud();
    saveProgress();
  }

  function useManagerPill() {
    if (!canSpendManagerMeter()) return;
    if (!bubbles.length) {
      playSfx("nope");
      log("The Big Pill needs a pile to bully.");
      return;
    }

    spendManagerMeter();
    const token = makeManagerToken("pill");
    managerTokens.push(token);
    shake = Math.max(shake, 4);
    playSfx("pill");
    log("Random manager ability: Big Pill. It will shove through the bubble pile.");
    updateHud();
    saveProgress();
  }

  function findBestPair() {
    let best = null;
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i];
        const b = bubbles[j];
        if (a.tier !== b.tier || a.tier >= MAX) continue;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const candidate = { a, b, score: a.tier * 1000 - dist };
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
    return best;
  }

  function useReceiptBlast() {
    if (!running || energy < RECEIPT_COST) {
      playSfx("nope");
      log("Not enough complaint energy for Receipt Blast.");
      return;
    }
    const pair = findBestPair();
    if (!pair) {
      playSfx("nope");
      log("Receipt Blast needs two matching bubbles.");
      return;
    }
    energy -= RECEIPT_COST;
    const now = performance.now() / 1000;
    pair.a.x = (pair.a.x + pair.b.x) / 2 - pair.a.r * 0.24;
    pair.b.x = (pair.a.x + pair.b.x) / 2 + pair.b.r * 0.24;
    pair.a.y = Math.min(pair.a.y, pair.b.y);
    pair.b.y = pair.a.y;
    playSfx("receipt");
    mergeBubbles(pair.a, pair.b, now + MERGE_COOLDOWN + 0.01);
    log("Receipt Blast forced a merge.");
    updateHud();
    saveProgress();
  }

  function useHoa() {
    if (!running || energy < HOA_COST) {
      playSfx("nope");
      log("Not enough complaint energy for an HOA Notice.");
      return;
    }
    energy -= HOA_COST;
    heat = clamp(heat - 34, 0, 100);
    dangerTime = 0;
    shake = 4;
    for (const b of bubbles) {
      b.vy -= 180;
      b.vx += (b.x < W / 2 ? -1 : 1) * 24;
    }
    playSfx("hoa");
    log("HOA Notice shoved the pile down and cooled the room.");
    updateHud();
    saveProgress();
  }

  function updateHud() {
    if (boardEl) boardEl.classList.toggle("karen-board--overlay", pausedByOverlay);
    if (scoreEl) scoreEl.textContent = score.toLocaleString();
    if (energyEl) energyEl.textContent = Math.floor(energy).toLocaleString();
    if (topEl) topEl.textContent = TIERS[topTier] ? TIERS[topTier].name : "-";
    if (heatEl) heatEl.textContent = Math.round(heat) + "%";
    if (bestEl) bestEl.textContent = api.getHighScore(GAME_ID).toLocaleString();
    const managerReady = managerMeter >= MANAGER_METER_MAX;
    const rolledAbility = managerReady ? ensureManagerAbility() : null;
    if (managerFill) managerFill.style.width = clamp(managerMeter, 0, MANAGER_METER_MAX) + "%";
    if (managerLabel) managerLabel.textContent = managerReady && rolledAbility ? managerAbilityLabel(rolledAbility).toUpperCase() : Math.round(managerMeter) + "%";
    if (heatFill) heatFill.style.width = clamp(heat, 0, 100) + "%";
    if (heatLabel) heatLabel.textContent = Math.round(heat) + "%";
    if (shakeFill) shakeFill.style.width = clamp(dangerTime / 2.25 * 100, 0, 100) + "%";
    if (shakeLabel) shakeLabel.textContent = Math.max(0, Math.ceil(2.25 - dangerTime)).toString();
    const managerDisabled = !running || pausedByOverlay || !managerReady || !bubbles.length || !rolledAbility;
    updateManagerButton(btnManager, managerDisabled, rolledAbility);
    if (btnReceipt) btnReceipt.disabled = !running || pausedByOverlay || energy < RECEIPT_COST || !findBestPair();
    if (btnHoa) btnHoa.disabled = !running || pausedByOverlay || energy < HOA_COST;
    if (btnDrop) btnDrop.disabled = !running || pausedByOverlay;
  }

  function updateManagerButton(button, disabled, ability) {
    if (!button) return;
    button.disabled = disabled;
    button.classList.toggle("karen-manager-button--ready", !disabled);
    button.textContent = ability && !disabled ? "Use " + managerAbilityLabel(ability) : "Manager " + Math.round(managerMeter) + "%";
    button.title = ability && !disabled ? "Use random manager ability: " + managerAbilityLabel(ability) : "Fill the manager meter to draw a random ability";
  }

  function hideContinueButton() {
    if (saveMenu && saveMenu.button) saveMenu.button.hidden = true;
  }

  function showOverlay(title, sub, btnLabel, scoreHtml, onClick) {
    overlayTitle.innerHTML = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = scoreHtml || "";
    btnPrimary.textContent = btnLabel;
    btnPrimary.onclick = onClick;
    overlayEl.classList.add("overlay--show");
    hideContinueButton();
    pausedByOverlay = true;
    updateHud();
  }

  function hideOverlay() {
    overlayEl.classList.remove("overlay--show");
    pausedByOverlay = false;
    updateHud();
  }

  function showGameOver() {
    if (!running) return;
    running = false;
    pausedByOverlay = true;
    playSfx("gameOver");
    if (saveSlot) saveSlot.clear();
    api.recordScore(GAME_ID, score);
    const best = api.getHighScore(GAME_ID);
    if (score > 0 && score >= best && score > bestAtStart) {
      setTimeout(() => api.toast("New high score!", "good"), 300);
    }
    showOverlay(
      "Store Closed.",
      "The bubble pile crossed the escalation line. Corporate has stopped answering the phone.",
      "Run it back",
      "Score: <strong>" + score.toLocaleString() +
        "</strong> / Top bubble: <strong>" + TIERS[topTier].name +
        "</strong> / High: <strong>" + best.toLocaleString() + "</strong>",
      newGame
    );
  }

  function showWin() {
    won = true;
    playSfx("win");
    api.recordScore(GAME_ID, score);
    const best = api.getHighScore(GAME_ID);
    showOverlay(
      "MANAGER ASCENDED",
      "You merged the Consumer Rights Kaiju bubble. Keep dropping for a bigger score, or start fresh before the aisle caves in.",
      "Keep dropping",
      "Score: <strong>" + score.toLocaleString() +
        "</strong> / High: <strong>" + best.toLocaleString() + "</strong>",
      hideOverlay
    );
    saveProgress();
  }

  function newGame() {
    if (saveSlot) saveSlot.clear();
    bubbles = [];
    managerTokens = [];
    pops = [];
    coupons = [];
    score = 0;
    energy = 35;
    heat = 0;
    managerMeter = 0;
    managerAbility = null;
    topTier = 1;
    uid = 0;
    aimX = W / 2;
    nextTier = randomNextTier();
    dangerTime = 0;
    managerFlash = 0;
    shake = 0;
    won = false;
    running = true;
    pausedByOverlay = false;
    lastDropAt = -10;
    bestAtStart = api.getHighScore(GAME_ID);
    playSfx("start");
    log("Aim, drop, and merge matching portrait bubbles.");
    updatePreview();
    hideOverlay();
    updateHud();
    saveProgress();
  }

  function snapshot() {
    return {
      bubbles: bubbles.map((b) => ({
        tier: b.tier,
        x: Math.round(b.x * 100) / 100,
        y: Math.round(b.y * 100) / 100,
        vx: Math.round(b.vx * 100) / 100,
        vy: Math.round(b.vy * 100) / 100,
      })),
      score,
      energy,
      heat,
      managerMeter,
      managerAbility,
      topTier,
      uid,
      aimX,
      nextTier,
      dangerTime,
      won,
      running,
    };
  }

  function saveProgress() {
    if (!saveSlot || !running) return;
    saveSlot.save(snapshot());
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data || !Array.isArray(data.bubbles)) return;
    bubbles = data.bubbles
      .map((item) => makeBubble(clamp(Number(item.tier) || 1, 1, MAX), Number(item.x) || W / 2, Number(item.y) || ROOF, {
        vx: Number(item.vx) || 0,
        vy: Number(item.vy) || 0,
      }))
      .filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
    managerTokens = [];
    pops = [];
    coupons = [];
    score = Number(data.score) || 0;
    energy = Number(data.energy) || 0;
    heat = clamp(Number(data.heat) || 0, 0, 100);
    managerMeter = clamp(Number(data.managerMeter) || 0, 0, MANAGER_METER_MAX);
    managerAbility = MANAGER_ABILITIES.includes(data.managerAbility) ? data.managerAbility : null;
    topTier = clamp(Number(data.topTier) || 1, 1, MAX);
    uid = Number(data.uid) || bubbles.length;
    aimX = clamp(Number(data.aimX) || W / 2, WALL + 34, W - WALL - 34);
    nextTier = clamp(Number(data.nextTier) || 1, 1, Math.min(5, MAX));
    dangerTime = clamp(Number(data.dangerTime) || 0, 0, 2);
    managerFlash = 0;
    shake = 0;
    won = Boolean(data.won);
    running = data.running !== false;
    pausedByOverlay = false;
    bestAtStart = api.getHighScore(GAME_ID);
    playSfx("start");
    updatePreview();
    hideOverlay();
    log("Progress restored. The bubble pile remembers.");
    updateHud();
  }

  function handlePointer(clientX, shouldDrop) {
    aimX = clamp(screenToCanvasX(clientX), WALL + 34, W - WALL - 34);
    if (shouldDrop) dropBubble();
  }

  canvas.addEventListener("pointermove", (event) => handlePointer(event.clientX, false));
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    handlePointer(event.clientX, true);
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      event.preventDefault();
      aim(-28);
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      event.preventDefault();
      aim(28);
    } else if (event.key === " " || event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      dropBubble();
    }
  });

  if (btnNew) btnNew.addEventListener("click", newGame);
  if (btnDrop) btnDrop.addEventListener("click", dropBubble);
  if (btnAimLeft) btnAimLeft.addEventListener("click", () => aim(-42));
  if (btnAimRight) btnAimRight.addEventListener("click", () => aim(42));
  if (btnManager) btnManager.addEventListener("click", useManager);
  if (btnReceipt) btnReceipt.addEventListener("click", useReceiptBlast);
  if (btnHoa) btnHoa.addEventListener("click", useHoa);
  if (btnFullscreen) btnFullscreen.addEventListener("click", toggleMaxed);
  if (btnSound) btnSound.addEventListener("click", toggleSound);
  document.addEventListener("fullscreenchange", syncFullscreenState);
  document.addEventListener("webkitfullscreenchange", syncFullscreenState);

  btnPrimary.onclick = newGame;
  makeLadder();
  updatePreview();
  updateSoundButton();
  updateHud();

  if (saveSlot) {
    saveMenu = saveSlot.attachButtons({
      primary: btnPrimary,
      scoreEl: overlayScore,
      continueLabel: "Continue",
      newLabel: "New game",
      onContinue: restoreGame,
      summary: (saved) => {
        const data = saved.data || {};
        const tier = TIERS[data.topTier] ? TIERS[data.topTier].name : "Tiny Complaint";
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Score <strong>${Number(data.score || 0).toLocaleString()}</strong> · ${tier}`;
      },
    });
    saveSlot.startAutosave(snapshot, () => running && !pausedByOverlay);
    saveMenu.refresh();
  }

  sheet.addEventListener("load", () => render(0));
  requestAnimationFrame(frame);

  window.__KAREN_MERGER = {
    TIERS,
    MAX,
    newGame,
    drop: dropBubble,
    aim,
    manager: useManager,
    managerClear: useManagerClear,
    managerMerge: useManagerMerge,
    managerPill: useManagerPill,
    receipt: useReceiptBlast,
    hoa: useHoa,
    sound: playSfx,
    toggleSound,
    toggleMaxed,
    isMaxed,
    forceBubble(tier, x, y, vx = 0, vy = 0) {
      const bubble = makeBubble(clamp(Number(tier) || 1, 1, MAX), Number(x) || W / 2, Number(y) || ROOF, { vx, vy });
      bubbles.push(bubble);
      topTier = Math.max(topTier, bubble.tier);
      updateHud();
      return bubble.id;
    },
    forceMerge(tier = 9) {
      bubbles = [];
      const t = clamp(Number(tier) || 9, 1, MAX - 1);
      bubbles.push(makeBubble(t, W / 2 - TIERS[t].radius * 0.4, FLOOR - TIERS[t].radius - 4));
      bubbles.push(makeBubble(t, W / 2 + TIERS[t].radius * 0.4, FLOOR - TIERS[t].radius - 4));
      topTier = Math.max(topTier, t);
      running = true;
      pausedByOverlay = false;
      return bubbles.map((b) => b.id);
    },
    clear() {
      bubbles = [];
      managerTokens = [];
      pops = [];
      coupons = [];
      topTier = 1;
      managerMeter = 0;
      managerAbility = null;
      updateHud();
    },
    setManagerMeter(value = MANAGER_METER_MAX) {
      managerMeter = clamp(Number(value) || 0, 0, MANAGER_METER_MAX);
      if (managerMeter < MANAGER_METER_MAX) managerAbility = null;
      else ensureManagerAbility();
      updateHud();
      return managerMeter;
    },
    setManagerAbility(value) {
      managerAbility = MANAGER_ABILITIES.includes(value) ? value : null;
      updateHud();
      return managerAbility;
    },
    vals: () => bubbles.map((b) => ({ tier: b.tier, x: b.x, y: b.y, r: b.r })),
    managerVals: () => managerTokens.map((token) => ({ kind: token.kind, x: token.x, y: token.y, r: token.r })),
    get score() { return score; },
    get energy() { return energy; },
    get heat() { return heat; },
    get managerMeter() { return managerMeter; },
    get managerAbility() { return managerAbility; },
    get managerReady() { return managerMeter >= MANAGER_METER_MAX; },
    get topTier() { return topTier; },
    get running() { return running; },
    get paused() { return pausedByOverlay; },
    get nextTier() { return nextTier; },
    get soundOn() { return soundOn; },
    get audioState() { return audioCtx ? audioCtx.state : "uninitialized"; },
    save: saveProgress,
    restore: () => restoreGame(saveSlot && saveSlot.read()),
  };
})();
