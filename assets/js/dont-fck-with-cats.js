/* ============================================
   DON'T F*CK WITH CATS
   - Cat-swarm runner parody with gates, auto-fire, and a vacuum boss.
   - Debug hook: window.__CLOWDER
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "dont-fck-with-cats";
  const GAME_TITLE = "Don't F*ck with Cats";
  const SCRIPT_URL = new URL(document.currentScript ? document.currentScript.src : window.location.href);
  const ART_ROOT = new URL("../img/clowder/", SCRIPT_URL);
  const ART_VERSION = "20260622-ingame-hud-1";
  const W = 960;
  const H = 600;
  const PLAYER_Y = 498;
  const VIEW_SCALE = 0.78;
  const VIEW_PAD_X = (W - W * VIEW_SCALE) / 2;
  const VIEW_PAD_Y = (H - H * VIEW_SCALE) / 2;
  const PLAY_MIN_X = 42;
  const PLAY_MAX_X = W - 42;
  const PLAY_TARGET_MIN = 46;
  const PLAY_TARGET_MAX = W - 46;
  const START_CATS = 9;
  const MAX_CATS = 84;
  const BOSS_ATTACK_WINDUP = 1.12;
  const BOSS_ATTACK_AIM_RADIUS = 74;
  const BOSS_ATTACK_DODGE_MARGIN = 18;
  const LEVELS = [
    {
      name: "Living Room Uprising",
      short: "Living Room",
      length: 3200,
      speed: 238,
      bossSpeed: 112,
      bossLabel: "Deluxe Vacuum",
      bossCaption: "VACUUM AUTHORITY",
      bossHp: 225,
      bossDamage: 5,
      bossColor: "#212838",
      bossAccent: "#ff2e88",
      bossPattern: "vacuum",
      gateEvery: [1040, 1320],
      objectEvery: [440, 640],
      hpMod: 1.14,
      damageMod: 1.14,
      clearBonus: 1100,
      intro: "Level 1: the living room has declared martial law.",
      palette: { top: "#071326", mid: "#111c2d", bottom: "#0b1422", glowA: "#2ee0ff", glowB: "#ff2e88" },
    },
    {
      name: "Kitchen Counter Siege",
      short: "Kitchen",
      length: 3600,
      speed: 268,
      bossSpeed: 124,
      bossLabel: "Cucumber Warlord",
      bossCaption: "UNLICENSED PRODUCE",
      bossHp: 300,
      bossDamage: 6,
      bossColor: "#245f37",
      bossAccent: "#8cff72",
      bossPattern: "cucumber",
      gateEvery: [960, 1220],
      objectEvery: [380, 560],
      hpMod: 1.3,
      damageMod: 1.24,
      clearBonus: 1500,
      intro: "Level 2: the kitchen counter is all traps, no snacks.",
      palette: { top: "#0d1e19", mid: "#17301f", bottom: "#101421", glowA: "#6bff7d", glowB: "#ffd43b" },
    },
    {
      name: "Vet Lobby Ambush",
      short: "Vet Lobby",
      length: 4000,
      speed: 294,
      bossSpeed: 132,
      bossLabel: "Bath Protocol",
      bossCaption: "WETNESS COMPLIANCE",
      bossHp: 390,
      bossDamage: 8,
      bossColor: "#1d5485",
      bossAccent: "#6dc8ff",
      bossPattern: "bath",
      gateEvery: [900, 1140],
      objectEvery: [330, 500],
      hpMod: 1.48,
      damageMod: 1.36,
      clearBonus: 2050,
      intro: "Level 3: the vet lobby smells like betrayal.",
      palette: { top: "#08172c", mid: "#102d4c", bottom: "#0e1421", glowA: "#6dc8ff", glowB: "#ff6f91" },
    },
    {
      name: "Hallway Doorbell Purge",
      short: "Hallway",
      length: 4400,
      speed: 306,
      bossSpeed: 136,
      bossLabel: "Doorbell Revenant",
      bossCaption: "RING RING RUIN",
      bossHp: 430,
      bossDamage: 8,
      bossColor: "#3a2418",
      bossAccent: "#ffb347",
      bossPattern: "squeeze",
      gateEvery: [840, 1080],
      objectEvery: [290, 450],
      hpMod: 1.56,
      damageMod: 1.4,
      clearBonus: 2350,
      intro: "Level 4: the hallway rings like a personal insult.",
      palette: { top: "#1a120d", mid: "#2a1c14", bottom: "#120d0a", glowA: "#ffb347", glowB: "#ff5e67" },
    },
    {
      name: "Backyard Laser Tribunal",
      short: "Backyard",
      length: 4800,
      speed: 318,
      bossSpeed: 140,
      bossLabel: "Laser Pointer Council",
      bossCaption: "RED DOT JURISDICTION",
      bossHp: 470,
      bossDamage: 9,
      bossColor: "#4a1824",
      bossAccent: "#ff3b5c",
      bossPattern: "pointer",
      gateEvery: [790, 1020],
      objectEvery: [260, 410],
      hpMod: 1.64,
      damageMod: 1.46,
      clearBonus: 2650,
      intro: "Level 5: the backyard has convened a red-dot hearing.",
      palette: { top: "#1a0f14", mid: "#2a1820", bottom: "#0d080c", glowA: "#ff3b5c", glowB: "#ffd43b" },
    },
    {
      name: "Garage Roomba Summit",
      short: "Garage",
      length: 5200,
      speed: 328,
      bossSpeed: 146,
      bossLabel: "Roomba Prime",
      bossCaption: "SUCTION CARTEL",
      bossHp: 540,
      bossDamage: 9,
      bossColor: "#1f2a3d",
      bossAccent: "#7ec8ff",
      bossPattern: "cucumber",
      gateEvery: [750, 980],
      objectEvery: [235, 370],
      hpMod: 1.74,
      damageMod: 1.52,
      clearBonus: 2950,
      intro: "Level 6: the garage is full of upgraded household villains.",
      palette: { top: "#0d121c", mid: "#182232", bottom: "#090d14", glowA: "#7ec8ff", glowB: "#ff2e88" },
    },
    {
      name: "Balcony Lint Inquisition",
      short: "Balcony",
      length: 5600,
      speed: 338,
      bossSpeed: 152,
      bossLabel: "Mega Lint Authority",
      bossCaption: "FIBER ENFORCEMENT",
      bossHp: 610,
      bossDamage: 10,
      bossColor: "#2d2248",
      bossAccent: "#c9a7ff",
      bossPattern: "lint",
      gateEvery: [710, 940],
      objectEvery: [210, 340],
      hpMod: 1.84,
      damageMod: 1.58,
      clearBonus: 3300,
      intro: "Level 7: the balcony judges your shedding habits.",
      palette: { top: "#140f22", mid: "#221836", bottom: "#09070f", glowA: "#c9a7ff", glowB: "#6dc8ff" },
    },
    {
      name: "Internet Comments Finale",
      short: "Comments",
      length: 6200,
      speed: 348,
      bossSpeed: 158,
      bossLabel: "Algorithmic HOA",
      bossCaption: "FINAL ENGAGEMENT FARM",
      bossHp: 720,
      bossDamage: 11,
      bossColor: "#311d55",
      bossAccent: "#ffd43b",
      bossPattern: "lint",
      gateEvery: [680, 900],
      objectEvery: [190, 310],
      hpMod: 1.95,
      damageMod: 1.66,
      clearBonus: 4200,
      intro: "Level 8: the comment section and the homeowners association have merged.",
      palette: { top: "#160b28", mid: "#251841", bottom: "#08070f", glowA: "#ff2e88", glowB: "#ffd43b" },
    },
  ];

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnNew = document.getElementById("btn-new");
  const btnPause = document.getElementById("btn-pause");
  const btnSound = document.getElementById("btn-sound");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const wrap = canvas.closest(".canvas-wrap");
  const logEl = document.getElementById("clowder-log");

  const hud = {
    score: document.getElementById("hud-score"),
    level: document.getElementById("hud-level"),
    cats: document.getElementById("hud-cats"),
    morale: document.getElementById("hud-morale"),
    distance: document.getElementById("hud-distance"),
    best: document.getElementById("hud-best"),
  };

  const C = {
    bg: "#091320",
    floorA: "#111c2d",
    floorB: "#0b1422",
    ink: "#fbfaf4",
    dim: "#b6b3c9",
    pink: "#ff2e88",
    cyan: "#2ee0ff",
    yellow: "#ffd43b",
    green: "#6bff7d",
    red: "#ff5e67",
    purple: "#b06cff",
    black: "#05070d",
  };

  const CAT_FURS = ["#f6a94d", "#f5f0de", "#687483", "#1d2027", "#d97545", "#f7d7ae", "#c9beb3", "#f0c052"];
  const RASTER_ART = {
    backdrop: loadRasterArt("generated-house-chaos-backdrop.png"),
    cats: [
      loadRasterArt("generated-cat-orange.png"),
      loadRasterArt("generated-cat-cream.png"),
      loadRasterArt("generated-cat-gray.png"),
    ],
    objects: {
      roomba: loadRasterArt("generated-roomba.png"),
      cucumber: loadRasterArt("generated-cucumber.png"),
      vacuum: loadRasterArt("generated-vacuum.png"),
      spray: loadRasterArt("generated-spray.png"),
      bath: loadRasterArt("generated-bath.png"),
      box: loadRasterArt("generated-box.png"),
      yarn: loadRasterArt("generated-yarn.png"),
      laser: loadRasterArt("generated-laser-pointer.png"),
    },
  };

  const GATE_POOL = [
    { type: "add", value: 6, label: "+6 KITTENS", good: true, color: C.green },
    { type: "add", value: 4, label: "+4 BOX CATS", good: true, color: C.cyan },
    { type: "multiply", value: 2, label: "x2 ZOOMIES", good: true, color: C.yellow },
    { type: "morale", value: 12, label: "+12 MORALE", good: true, color: "#9cffef" },
    { type: "subtract", value: 10, label: "-10 BATH", good: false, color: C.red },
    { type: "divide", value: 2, label: "/2 CUCUMBER", good: false, color: "#7ad65f" },
    { type: "subtract", value: 14, label: "-14 VET BILL", good: false, color: "#ff965e" },
    { type: "morale", value: -34, label: "-34 VACUUM", good: false, color: "#ff6f91" },
  ];

  const GATE_EDGE = 24;
  const GATE_SPLIT = W / 2;
  const GATE_PAIR_LAYOUT = [
    { x: GATE_EDGE, w: GATE_SPLIT - GATE_EDGE },
    { x: GATE_SPLIT, w: W - GATE_SPLIT - GATE_EDGE },
  ];

  const GATE_MATH_EASY = [
    ["+6 KITTENS", "-10 BATH"],
    ["+6 KITTENS", "-14 VET BILL"],
    ["+4 BOX CATS", "-10 BATH"],
    ["+4 BOX CATS", "-14 VET BILL"],
    ["+6 KITTENS", "/2 CUCUMBER"],
  ];

  const GATE_MATH_MEDIUM = [
    ["+6 KITTENS", "+4 BOX CATS"],
    ["x2 ZOOMIES", "-10 BATH"],
    ["x2 ZOOMIES", "-14 VET BILL"],
    ["+12 MORALE", "-34 VACUUM"],
    ["+4 BOX CATS", "/2 CUCUMBER"],
  ];

  const GATE_MATH_HARD = [
    ["x2 ZOOMIES", "+6 KITTENS"],
    ["x2 ZOOMIES", "+4 BOX CATS"],
    ["+12 MORALE", "+4 BOX CATS"],
    ["+6 KITTENS", "+12 MORALE"],
    ["-10 BATH", "/2 CUCUMBER"],
    ["-14 VET BILL", "/2 CUCUMBER"],
  ];

  const GATE_MATH_BRUTAL = [
    ["x2 ZOOMIES", "+12 MORALE"],
    ["+4 BOX CATS", "+12 MORALE"],
    ["-10 BATH", "-14 VET BILL"],
    ["+12 MORALE", "-34 VACUUM"],
    ["x2 ZOOMIES", "/2 CUCUMBER"],
  ];

  const OBJECT_POOL = [
    { kind: "roomba", label: "ROOMBA", hp: 10, damage: 8, score: 110, w: 112, h: 58, color: "#26364f" },
    { kind: "cucumber", label: "CUCUMBER", hp: 5, damage: 6, score: 70, w: 92, h: 54, color: "#45c966" },
    { kind: "spray", label: "SPRAY", hp: 8, damage: 9, score: 90, w: 78, h: 88, color: "#6dc8ff" },
    { kind: "bath", label: "BATH WATER", hp: 9, damage: 11, score: 120, w: 132, h: 62, color: "#37a6ff" },
    { kind: "box", label: "+2 BOX CATS", hp: 6, damage: 0, rewardCats: 2, score: 80, w: 118, h: 72, color: "#bd7a3a" },
    { kind: "yarn", label: "+1 YARN CREW", hp: 4, damage: 0, rewardCats: 1, score: 60, w: 76, h: 76, color: "#ffb1d6" },
  ];

  const SOUND_PREF_KEY = "rainbot_dont_fck_with_cats_sound";
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let soundOn = readSoundPreference();

  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;
  let rafId = 0;
  let lastT = 0;
  let bestAtStart = api.getHighScore(GAME_ID);

  const input = {
    left: false,
    right: false,
    pointer: false,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  function loadRasterArt(fileName) {
    const image = new Image();
    image.decoding = "async";
    const src = new URL(fileName, ART_ROOT);
    src.searchParams.set("v", ART_VERSION);
    image.src = src.href;
    return image;
  }

  function imageReady(image) {
    return Boolean(image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  }

  function currentLevel() {
    return LEVELS[clamp(Math.round(state?.levelIndex || 0), 0, LEVELS.length - 1)];
  }

  function levelNumber() {
    return clamp(Math.round(state?.levelIndex || 0), 0, LEVELS.length - 1) + 1;
  }

  function levelProgress() {
    const level = currentLevel();
    return clamp(state.distance / level.length, 0, 1);
  }

  function makeInitialState() {
    return {
      mode: "menu",
      started: false,
      paused: false,
      x: W / 2,
      targetX: W / 2,
      levelIndex: 0,
      cats: START_CATS,
      morale: 100,
      score: 0,
      distance: 0,
      speed: LEVELS[0].speed,
      time: 0,
      combo: 0,
      fireTimer: 0,
      nextGateAt: 620,
      nextObjectAt: 540,
      nextPairId: 1,
      appliedPairs: [],
      bossSpawned: false,
      boss: null,
      gates: [],
      obstacles: [],
      bullets: [],
      particles: [],
      floats: [],
      levelBanner: 2.4,
      catHitFlash: 0,
      catScatterTimer: 0,
      log: [LEVELS[0].intro],
    };
  }

  let state = makeInitialState();

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
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain || 0.035, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function sfx(name) {
    if (!soundOn) return;
    if (name === "shoot") {
      tone(620, 0.035, { type: "square", gain: 0.012, to: 880 });
    } else if (name === "hit") {
      tone(220, 0.05, { type: "triangle", gain: 0.02 });
    } else if (name === "gateGood") {
      [330, 495, 660].forEach((f, i) => tone(f, 0.08, { type: "triangle", gain: 0.028, delay: i * 0.045 }));
    } else if (name === "gateBad") {
      tone(160, 0.16, { type: "sawtooth", gain: 0.034, to: 70 });
    } else if (name === "boss") {
      tone(88, 0.24, { type: "sawtooth", gain: 0.04, to: 44 });
      tone(176, 0.18, { type: "square", gain: 0.025, delay: 0.08 });
    } else if (name === "bossHit") {
      tone(120, 0.12, { type: "sawtooth", gain: 0.03, to: 58 });
      tone(240, 0.08, { type: "triangle", gain: 0.022, delay: 0.05 });
    } else if (name === "bossDodge") {
      tone(520, 0.07, { type: "triangle", gain: 0.02 });
      tone(780, 0.06, { type: "sine", gain: 0.016, delay: 0.04 });
    } else if (name === "win") {
      [392, 523, 659, 784].forEach((f, i) => tone(f, 0.11, { type: "triangle", gain: 0.03, delay: i * 0.07 }));
    } else if (name === "lose") {
      tone(190, 0.25, { type: "sawtooth", gain: 0.04, to: 55 });
    } else if (name === "start") {
      tone(250, 0.08, { type: "triangle", gain: 0.025 });
      tone(500, 0.12, { type: "triangle", gain: 0.024, delay: 0.07 });
    }
  }

  function setSoundLabel() {
    if (!btnSound) return;
    btnSound.textContent = soundOn ? "Sound On" : "Sound Off";
    btnSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  }

  function toggleSound() {
    soundOn = !soundOn;
    writeSoundPreference();
    setSoundLabel();
    if (soundOn) sfx("start");
  }

  function addLog(message) {
    state.log.unshift(message);
    state.log = state.log.slice(0, 5);
    renderLog();
  }

  function renderLog() {
    if (!logEl) return;
    logEl.innerHTML = state.log.map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function addFloat(x, y, text, color) {
    state.floats.push({ x, y, text, color: color || C.ink, life: 1, ttl: 1 });
  }

  function addParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      state.particles.push({
        x,
        y,
        vx: rand(-120, 120),
        vy: rand(-160, 70),
        r: rand(2, 5),
        color,
        life: rand(0.35, 0.8),
        ttl: rand(0.35, 0.8),
      });
    }
  }

  function updateHud() {
    if (hud.score) hud.score.textContent = Math.round(state.score).toLocaleString();
    if (hud.level) hud.level.textContent = `${levelNumber()}/${LEVELS.length}`;
    if (hud.cats) hud.cats.textContent = Math.max(0, Math.round(state.cats)).toLocaleString();
    if (hud.morale) hud.morale.textContent = `${Math.max(0, Math.round(state.morale))}%`;
    if (hud.distance) {
      hud.distance.textContent = state.boss ? "BOSS" : `${Math.round(levelProgress() * 100)}%`;
    }
    if (hud.best) hud.best.textContent = api.getHighScore(GAME_ID).toLocaleString();
    if (btnPause) btnPause.textContent = state.paused ? "Resume" : "Pause";
  }

  function showOverlay(config) {
    if (!overlayEl) return;
    overlayEl.classList.add("overlay--show");
    if (overlayTitle) overlayTitle.textContent = config.title || GAME_TITLE.toUpperCase();
    if (overlaySub) overlaySub.innerHTML = config.body || "";
    if (overlayScore) {
      overlayScore.style.display = config.score ? "block" : "";
      overlayScore.innerHTML = config.score || "";
    }
    if (btnPrimary) btnPrimary.textContent = config.button || "Start herding";
    if (saveMenu && typeof saveMenu.refresh === "function") saveMenu.refresh();
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.classList.remove("overlay--show");
  }

  function resetRuntimeArrays(data) {
    data.gates = Array.isArray(data.gates) ? data.gates : [];
    data.obstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
    data.bullets = Array.isArray(data.bullets) ? data.bullets : [];
    data.particles = Array.isArray(data.particles) ? data.particles : [];
    data.floats = Array.isArray(data.floats) ? data.floats : [];
    data.appliedPairs = Array.isArray(data.appliedPairs) ? data.appliedPairs : [];
    data.levelIndex = clamp(Math.round(Number(data.levelIndex) || 0), 0, LEVELS.length - 1);
    data.levelBanner = Number(data.levelBanner) || 0;
    data.log = Array.isArray(data.log) && data.log.length ? data.log.slice(0, 5) : [LEVELS[data.levelIndex].intro];
    return data;
  }

  function newGame() {
    state = makeInitialState();
    state.mode = "playing";
    state.started = true;
    bestAtStart = api.getHighScore(GAME_ID);
    hideOverlay();
    updateHud();
    renderLog();
    sfx("start");
    saveProgress();
    lastT = performance.now();
    canvas.focus({ preventScroll: true });
  }

  function togglePause() {
    if (state.mode !== "playing") return;
    state.paused = !state.paused;
    updateHud();
    saveProgress();
    if (!state.paused) lastT = performance.now();
  }

  function finishRun(won, reason) {
    if (state.mode !== "playing") return;
    state.mode = won ? "won" : "gameover";
    state.started = false;
    state.paused = false;
    const finalScore = Math.max(0, Math.round(state.score));
    const high = api.recordScore(GAME_ID, finalScore);
    if (saveSlot) saveSlot.clear();
    updateHud();
    if (saveMenu && typeof saveMenu.refresh === "function") saveMenu.refresh();
    sfx(won ? "win" : "lose");
    if (high) setTimeout(() => api.toast(`New ${GAME_TITLE} high score!`, "good"), 250);

    showOverlay({
      title: won ? "CATS WIN THE INTERNET" : "CATS HAVE LEFT THE CHAT",
      body: won
        ? `${LEVELS.length} levels of household nonsense have been reduced to apologetic debris. The cats accept no interviews and several treats.`
        : reason || "The last cat sat down, stared at you, and ended the campaign.",
      score: `Final score: <strong>${finalScore.toLocaleString()}</strong>${high ? "<br><strong>New high score</strong>" : "<br>High: <strong>" + api.getHighScore(GAME_ID).toLocaleString() + "</strong>"}`,
      button: "New run",
    });
  }

  function pairApplied(pairId) {
    return state.appliedPairs.includes(pairId);
  }

  function markPair(pairId) {
    if (!pairApplied(pairId)) state.appliedPairs.push(pairId);
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, pad = 0) {
    return ax - pad < bx + bw && ax + aw + pad > bx && ay - pad < by + bh && ay + ah + pad > by;
  }

  function objectOverlapsGate(x, y, w, h) {
    const pad = 20;
    return state.gates.some((gate) => rectsOverlap(x, y, w, h, gate.x, gate.y, gate.w, gate.h, pad));
  }

  function objectOverlapsObstacle(x, y, w, h) {
    const pad = 56;
    return state.obstacles.some((ob) => rectsOverlap(x, y, w, h, ob.x, ob.y, ob.w, ob.h, pad));
  }

  function shuffleList(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function objectLaneCenters() {
    const margin = PLAY_MIN_X + 48;
    const usable = W - margin * 2;
    const lanes = [];
    for (let i = 0; i < 7; i++) {
      lanes.push(margin + (usable * (i + 0.5)) / 7);
    }
    return shuffleList(lanes);
  }

  function gateDifficulty() {
    const levelFrac = state.levelIndex / Math.max(1, LEVELS.length - 1);
    const runFrac = clamp(state.distance / currentLevel().length, 0, 1);
    return clamp(levelFrac * 0.7 + runFrac * 0.3, 0, 1);
  }

  function estimateGateValue(gate) {
    const cats = state.cats;
    if (gate.type === "add") return gate.value;
    if (gate.type === "subtract") return -gate.value;
    if (gate.type === "multiply") return cats >= 38 ? 7 : cats * (gate.value - 1);
    if (gate.type === "divide") return -(cats - Math.floor(cats / gate.value));
    if (gate.type === "morale") return gate.value * 0.12;
    return 0;
  }

  function gateByLabel(label) {
    return GATE_POOL.find((gate) => gate.label === label);
  }

  function pickCloseValuePair() {
    let bestGap = Infinity;
    let pair = [pick(GATE_POOL), pick(GATE_POOL)];
    for (let i = 0; i < 64; i++) {
      const g1 = pick(GATE_POOL);
      const g2 = pick(GATE_POOL.filter((g) => g.label !== g1.label));
      const gap = Math.abs(estimateGateValue(g1) - estimateGateValue(g2));
      if (gap < bestGap) {
        bestGap = gap;
        pair = [g1, g2];
      }
    }
    return pair;
  }

  function pickGatePairSpecs() {
    const difficulty = gateDifficulty();
    let pool = GATE_MATH_EASY;

    if (difficulty < 0.24) {
      pool = GATE_MATH_EASY;
    } else if (difficulty < 0.48) {
      pool = GATE_MATH_MEDIUM;
    } else if (difficulty < 0.74) {
      pool = GATE_MATH_HARD;
    } else if (difficulty < 0.9) {
      pool = GATE_MATH_BRUTAL;
    } else {
      const [a, b] = pickCloseValuePair();
      return Math.random() > 0.5 ? [a, b] : [b, a];
    }

    const labels = pick(pool);
    const specs = labels.map((label) => ({ ...gateByLabel(label) }));
    if (Math.random() > 0.5) specs.reverse();
    return specs;
  }

  function gateForPlayer(gates) {
    const left = gates.find((gate) => gate.x < GATE_SPLIT) || gates[0];
    const right = gates.find((gate) => gate.x >= GATE_SPLIT) || gates[1];
    return state.x < GATE_SPLIT ? left : right;
  }

  function spawnGatePair() {
    const level = currentLevel();
    const pairId = state.nextPairId++;
    const specs = pickGatePairSpecs();
    specs.forEach((spec, i) => {
      const layout = GATE_PAIR_LAYOUT[i];
      state.gates.push({
        ...spec,
        pairId,
        x: layout.x,
        y: -112,
        w: layout.w,
        h: 92,
        levelName: level.short,
      });
    });
  }

  function pickObjectSpec() {
    const hazards = OBJECT_POOL.filter((o) => !o.rewardCats);
    const rewards = OBJECT_POOL.filter((o) => o.rewardCats);
    let hazardChance = state.cats >= 42 ? 0.66 : state.cats >= 26 ? 0.52 : state.cats >= 16 ? 0.36 : 0.22;
    hazardChance += state.levelIndex * 0.045;
    hazardChance = clamp(hazardChance, 0.18, 0.76);
    return { ...pick(Math.random() < hazardChance ? hazards : rewards) };
  }

  function spawnObject() {
    const level = currentLevel();
    const spec = pickObjectSpec();
    const levelScale = 1 + state.levelIndex * 0.04;
    const scale = (spec.kind === "roomba" && state.distance > level.length * 0.55 ? 1.16 : 1) * levelScale;
    const w = spec.w * scale;
    const h = spec.h * scale;
    const y = rand(-190, -88);
    const minX = PLAY_MIN_X + 6;
    const maxX = PLAY_MAX_X - w - 6;
    const laneCenters = objectLaneCenters();
    let placed = false;

    for (let attempt = 0; attempt < laneCenters.length + 6; attempt++) {
      const lane = (laneCenters[attempt % laneCenters.length] || rand(minX + w / 2, maxX + w / 2)) + rand(-34, 34);
      const x = clamp(lane - w / 2, minX, maxX);
      if (!objectOverlapsGate(x, y, w, h) && !objectOverlapsObstacle(x, y, w, h)) {
        state.obstacles.push({
          ...spec,
          x,
          y,
          w,
          h,
          hp: Math.ceil(spec.hp * scale * level.hpMod),
          maxHp: Math.ceil(spec.hp * scale * level.hpMod),
          damage: Math.ceil(spec.damage * level.damageMod),
          score: Math.ceil(spec.score * (1 + state.levelIndex * 0.22)),
          rewardCats: spec.rewardCats || 0,
          spin: rand(0, Math.PI * 2),
          hitFlash: 0,
        });
        placed = true;
        break;
      }
    }

    if (!placed) {
      state.nextObjectAt += rand(140, 220);
    }
  }

  const BOSS_PATTERN_HINTS = {
    vacuum: "Dodge the suction zone before it slurps your cats.",
    cucumber: "Let the rolling cucumbers pass — don't stand in their lane.",
    bath: "Rush to the dry lane before the splash hits.",
    lint: "Slip into the gap before the lint roller crushes you.",
    squeeze: "Hold the center lane while the sides get blasted.",
    pointer: "Stay off the sweeping red dot when it locks in.",
  };

  function playerLane() {
    if (state.x < W * 0.34) return "left";
    if (state.x > W * 0.66) return "right";
    return "center";
  }

  function calcBossLoss(boss) {
    return Math.max(3, Math.floor(boss.damage * 1.02 + (1 - boss.hp / boss.maxHp) * (3 + state.levelIndex * 0.85)));
  }

  function bossAttackCooldown(pattern) {
    if (pattern === "cucumber") return rand(1.35, 1.95);
    if (pattern === "bath") return rand(1.65, 2.35);
    if (pattern === "lint") return rand(1.45, 2.1);
    if (pattern === "squeeze") return rand(1.4, 2.05);
    if (pattern === "pointer") return rand(1.3, 1.95);
    return rand(1.55, 2.25);
  }

  function vacuumAttackParams(boss) {
    const opener = (boss.attackCount || 0) === 0;
    return {
      ttl: opener ? 0.86 : BOSS_ATTACK_WINDUP,
      maxTtl: opener ? 0.86 : BOSS_ATTACK_WINDUP,
      strikeAt: opener ? 0.54 : 0.68,
      aimRadius: opener ? 96 : BOSS_ATTACK_AIM_RADIUS,
      dodgeMargin: opener ? 8 : BOSS_ATTACK_DODGE_MARGIN,
      trackStrength: opener ? 4.6 : 2.1,
    };
  }

  function beginBossAttack(boss) {
    const loss = calcBossLoss(boss);
    const pattern = boss.pattern || "vacuum";
    boss.attackCount = (boss.attackCount || 0) + 1;

    if (pattern === "cucumber") {
      const fromLeft = Math.random() > 0.5;
      const count = state.levelIndex >= 2 || boss.label === "Roomba Prime" ? (Math.random() > 0.2 ? 2 : 1) : 1;
      const rollers = [];
      for (let i = 0; i < count; i++) {
        const left = count === 1 ? fromLeft : i === 0;
        rollers.push({
          x: left ? -80 - i * 40 : W + 80 + i * 40,
          y: PLAYER_Y - 18 + i * 8,
          vx: left ? rand(470, 560) : rand(-560, -470),
          w: 56,
          h: 30,
        });
      }
      boss.attackFx = {
        type: "cucumber",
        ttl: 1.28,
        maxTtl: 1.28,
        strikeAt: 0.7,
        loss,
        resolved: false,
        dodged: false,
        rollers,
      };
      return;
    }

    if (pattern === "bath") {
      const lanes = ["left", "center", "right"];
      const dryLane = pick(lanes);
      boss.attackFx = {
        type: "bath",
        ttl: 1.18,
        maxTtl: 1.18,
        strikeAt: 0.66,
        loss,
        resolved: false,
        dodged: false,
        dryLane,
      };
      return;
    }

    if (pattern === "lint") {
      const gapCenters = [W * 0.24, W * 0.5, W * 0.76];
      boss.attackFx = {
        type: "lint",
        ttl: 1.22,
        maxTtl: 1.22,
        strikeAt: 0.7,
        loss,
        resolved: false,
        dodged: false,
        gapX: pick(gapCenters) + rand(-28, 28),
        gapWidth: Math.max(124, 172 - state.levelIndex * 6),
        sweepStart: boss.y + boss.h * 0.35,
      };
      return;
    }

    if (pattern === "squeeze") {
      boss.attackFx = {
        type: "squeeze",
        ttl: 1.18,
        maxTtl: 1.18,
        strikeAt: 0.66,
        loss,
        resolved: false,
        dodged: false,
      };
      return;
    }

    if (pattern === "pointer") {
      const startX = clamp(state.x + rand(-100, 100), W * 0.16, W * 0.84);
      const travel = startX < W / 2 ? 1 : -1;
      boss.attackFx = {
        type: "pointer",
        ttl: 1.22,
        maxTtl: 1.22,
        strikeAt: 0.64,
        loss,
        resolved: false,
        dodged: false,
        dotStart: startX,
        dotEnd: clamp(startX + travel * rand(260, 360), 110, W - 110),
        dotX: startX,
        hitRadius: state.levelIndex >= 4 ? 54 : 48,
      };
      return;
    }

    const vacuum = vacuumAttackParams(boss);
    boss.attackFx = {
      type: "vacuum",
      ttl: vacuum.ttl,
      maxTtl: vacuum.maxTtl,
      strikeAt: vacuum.strikeAt,
      loss,
      resolved: false,
      dodged: false,
      aimX: state.x,
      aimRadius: vacuum.aimRadius,
      dodgeMargin: vacuum.dodgeMargin,
      trackStrength: vacuum.trackStrength,
      targetY: PLAYER_Y - 24,
    };
  }

  function resolveBossAttack(boss, fx) {
    fx.resolved = true;
    let dodged = false;
    let loss = fx.loss;
    let dodgeLabel = "DODGED";

    if (fx.type === "vacuum") {
      const dodgeDist = (fx.aimRadius ?? BOSS_ATTACK_AIM_RADIUS) + (fx.dodgeMargin ?? BOSS_ATTACK_DODGE_MARGIN);
      const missDist = Math.abs(state.x - fx.aimX);
      if (missDist > dodgeDist) dodged = true;
      else {
        const edgeFactor = clamp((dodgeDist - missDist) / (fx.aimRadius ?? BOSS_ATTACK_AIM_RADIUS), 0.42, 1);
        loss = Math.max(1, Math.round(fx.loss * edgeFactor));
      }
    } else if (fx.type === "cucumber") {
      dodged = !(fx.rollers || []).some((roller) => Math.abs(state.x - roller.x) < 58);
      dodgeLabel = "CLEAN DODGE";
    } else if (fx.type === "bath") {
      dodged = playerLane() === fx.dryLane;
      dodgeLabel = "STAYED DRY";
    } else if (fx.type === "lint") {
      dodged = Math.abs(state.x - fx.gapX) <= fx.gapWidth / 2 - 8;
      dodgeLabel = "GAP FOUND";
    } else if (fx.type === "squeeze") {
      dodged = playerLane() === "center";
      dodgeLabel = "CENTER HOLD";
    } else if (fx.type === "pointer") {
      dodged = Math.abs(state.x - fx.dotX) > (fx.hitRadius || 48);
      dodgeLabel = "DOT DODGED";
    }

    if (dodged) {
      fx.dodged = true;
      addFloat(state.x, PLAYER_Y - 90, dodgeLabel, C.cyan);
      addLog(`${boss.label || "Boss"} whiffed. The cats looked insulted on purpose.`);
      sfx("bossDodge");
      return;
    }

    damageCats(loss, boss.label || "Boss", {
      bossAttack: true,
      fromX: boss.x,
      fromY: boss.y + boss.h / 2,
      accent: boss.accent || C.purple,
    });
  }

  function spawnBoss() {
    const level = currentLevel();
    state.bossSpawned = true;
    state.speed = level.bossSpeed;
    const pattern = level.bossPattern || "vacuum";
    state.boss = {
      x: W / 2,
      y: -150,
      w: 256,
      h: 132,
      hp: level.bossHp,
      maxHp: level.bossHp,
      label: level.bossLabel,
      caption: level.bossCaption,
      damage: level.bossDamage,
      color: level.bossColor,
      accent: level.bossAccent,
      pattern,
      attackTimer: pattern === "vacuum" ? 0.95 : 1.35,
      attackCount: 0,
      phase: 0,
      hitFlash: 0,
    };
    state.gates.length = 0;
    addLog(`${level.bossLabel} entered ${level.short}. ${BOSS_PATTERN_HINTS[pattern] || ""}`);
    sfx("boss");
  }

  function applyGate(gate) {
    if (!gate) return;
    const before = state.cats;
    if (gate.type === "add") {
      state.cats = clamp(Math.round(state.cats + gate.value), 0, MAX_CATS);
    } else if (gate.type === "subtract") {
      state.cats = clamp(Math.round(state.cats - gate.value), 0, MAX_CATS);
    } else if (gate.type === "multiply") {
      if (state.cats >= 38) state.cats = clamp(state.cats + 7, 0, MAX_CATS);
      else state.cats = clamp(Math.round(state.cats * gate.value), 0, MAX_CATS);
    } else if (gate.type === "divide") {
      state.cats = clamp(Math.floor(state.cats / gate.value), 0, MAX_CATS);
    } else if (gate.type === "morale") {
      state.morale = clamp(state.morale + gate.value, 0, 100);
    }

    const catDelta = Math.round(state.cats - before);
    if (gate.good) {
      state.score += 150 + Math.max(0, catDelta) * 20;
      addFloat(state.x, PLAYER_Y - 90, gate.label, gate.color);
      addLog(`${gate.label}: the cats briefly formed a committee.`);
      sfx("gateGood");
    } else {
      state.combo = 0;
      addFloat(state.x, PLAYER_Y - 90, gate.label, gate.color);
      addLog(`${gate.label}: several cats remembered appointments.`);
      sfx("gateBad");
    }

    if (state.cats <= 0) finishRun(false, "The gate math produced zero cats, which is not a cat-based revenge movement, legally or spiritually.");
    if (state.morale <= 0) finishRun(false, "Morale hit zero. The remaining cats filed a noise complaint and left.");
  }

  function scatterCatsFromAttack(count, fromX, fromY, accent) {
    const burst = Math.max(6, Math.min(28, Math.round(count * 3)));
    for (let i = 0; i < burst; i++) {
      const angle = rand(-Math.PI * 0.88, -Math.PI * 0.12);
      const speed = rand(150, 360);
      state.particles.push({
        x: state.x + rand(-42, 42),
        y: PLAYER_Y + rand(-34, 18),
        vx: Math.cos(angle) * speed + rand(-40, 40),
        vy: Math.sin(angle) * speed - rand(40, 140),
        r: rand(4, 8),
        color: pick(CAT_FURS),
        life: rand(0.45, 0.75),
        ttl: rand(0.45, 0.75),
        kind: "cat",
      });
    }
    addParticles(fromX, fromY + 18, accent || C.purple, 22);
    state.catHitFlash = 0.34;
    state.catScatterTimer = 0.42;
  }

  function damageCats(amount, source, options = {}) {
    if (amount <= 0 || state.mode !== "playing") return;
    const loss = Math.min(state.cats, Math.ceil(amount));
    state.cats = clamp(state.cats - loss, 0, MAX_CATS);
    state.morale = clamp(state.morale - amount * 2.1, 0, 100);
    state.combo = 0;
    addFloat(state.x, PLAYER_Y - 72, `-${loss} CATS`, C.red);
    addLog(`${source} scattered ${loss} cat${loss === 1 ? "" : "s"}.`);
    if (options.bossAttack) {
      scatterCatsFromAttack(loss, options.fromX ?? state.x, options.fromY ?? PLAYER_Y - 40, options.accent);
    }
    sfx(options.bossAttack ? "bossHit" : "gateBad");
    if (state.cats <= 0) finishRun(false, `${source} left the campaign with no deployable cats.`);
    if (state.morale <= 0) finishRun(false, "Morale collapsed. Everyone is under the couch now.");
  }

  function destroyObject(object) {
    state.score += object.score + state.combo * 12;
    state.combo = clamp(state.combo + 1, 0, 25);
    addParticles(object.x + object.w / 2, object.y + object.h / 2, object.color, 16);
    if (object.rewardCats) {
      state.cats = clamp(state.cats + object.rewardCats, 0, MAX_CATS);
      state.morale = clamp(state.morale + object.rewardCats * 2, 0, 100);
      addFloat(object.x + object.w / 2, object.y, `+${object.rewardCats} CATS`, C.green);
      addLog(`${object.label} opened. Cat inventory increased.`);
      sfx("gateGood");
    } else {
      addFloat(object.x + object.w / 2, object.y, `+${object.score}`, C.yellow);
      sfx("hit");
    }
  }

  function completeLevel() {
    const cleared = currentLevel();
    const finalLevel = state.levelIndex >= LEVELS.length - 1;
    const clearScore = cleared.clearBonus + state.cats * 35 + Math.round(state.morale * 10);
    state.score += clearScore;
    addParticles(state.boss.x, state.boss.y + state.boss.h / 2, cleared.bossAccent, 70);

    if (finalLevel) {
      finishRun(true);
      return;
    }

    state.levelIndex += 1;
    const next = currentLevel();
    state.distance = 0;
    state.speed = next.speed;
    state.bossSpawned = false;
    state.boss = null;
    state.gates = [];
    state.obstacles = [];
    state.bullets = [];
    state.appliedPairs = [];
    state.nextGateAt = 560;
    state.nextObjectAt = 460;
    state.cats = clamp(state.cats + 2 + state.levelIndex, 1, MAX_CATS);
    state.morale = clamp(state.morale + 8, 0, 100);
    state.levelBanner = 2.8;
    addFloat(W / 2, 124, `LEVEL ${levelNumber()}`, next.bossAccent || C.yellow);
    addLog(`${cleared.name} cleared. ${next.name} unlocked.`);
    sfx("win");
    saveProgress();
  }

  function nearestTarget(fromX) {
    let best = null;
    let bestScore = Infinity;
    if (state.boss) {
      best = {
        x: state.boss.x,
        y: state.boss.y + state.boss.h / 2,
        boss: true,
      };
      bestScore = Math.abs(state.boss.x - fromX) + Math.max(0, state.boss.y) * 0.25;
    }
    state.obstacles.forEach((ob) => {
      if (ob.y > PLAYER_Y - 10) return;
      const cx = ob.x + ob.w / 2;
      const score = Math.abs(cx - fromX) + Math.abs(ob.y - PLAYER_Y) * 0.25;
      if (score < bestScore) {
        best = { x: cx, y: ob.y + ob.h / 2 };
        bestScore = score;
      }
    });
    return best;
  }

  function fireVolley() {
    if (state.mode !== "playing" || state.paused || state.cats <= 0) return;
    const count = clamp(1 + Math.floor(state.cats / 24), 1, 6);
    const spread = clamp(20 + state.cats * 0.48, 26, 92);
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const sx = state.x + (t - 0.5) * spread + rand(-8, 8);
      const target = nearestTarget(sx);
      const desired = target ? target.x : sx + rand(-55, 55);
      const hairball = Math.random() < 0.22;
      state.bullets.push({
        x: sx,
        y: PLAYER_Y - rand(34, 70),
        vx: clamp((desired - sx) * 0.95, -165, 165),
        vy: hairball ? -430 : -620,
        damage: hairball ? 2 : 1,
        r: hairball ? 5.5 : 3.2,
        color: hairball ? "#f3d7b0" : C.cyan,
        ttl: 1.45,
        kind: hairball ? "hairball" : "laser",
      });
    }
    sfx("shoot");
  }

  function update(dt) {
    if (state.mode !== "playing" || state.paused) return;

    state.time += dt;
    if (input.left) state.targetX -= 560 * dt;
    if (input.right) state.targetX += 560 * dt;
    state.targetX = clamp(state.targetX, PLAY_TARGET_MIN, PLAY_TARGET_MAX);
    state.x += (state.targetX - state.x) * clamp(dt * 9.5, 0, 1);
    state.x = clamp(state.x, PLAY_MIN_X, PLAY_MAX_X);

    if (!state.boss) {
      const level = currentLevel();
      state.distance += state.speed * dt;
      if (state.distance >= state.nextGateAt) {
        spawnGatePair();
        state.nextGateAt += rand(level.gateEvery[0], level.gateEvery[1]);
      }
      if (state.distance >= state.nextObjectAt) {
        spawnObject();
        state.nextObjectAt += rand(level.objectEvery[0], level.objectEvery[1]);
      }
      if (state.distance >= level.length) {
        spawnBoss();
      }
    }

    state.fireTimer -= dt;
    const fireEvery = clamp(0.2 - state.cats * 0.00145, 0.085, 0.2);
    while (state.fireTimer <= 0) {
      state.fireTimer += fireEvery;
      fireVolley();
    }

    const scroll = state.speed * dt * (state.boss ? 0.58 : 1);

    updateGates(scroll);
    updateObjects(scroll, dt);
    updateBoss(dt);
    updateBullets(dt);
    updateParticles(dt);

    if (state.levelBanner > 0) state.levelBanner -= dt;

    if (state.morale < 100 && state.time % 1 < dt && state.cats > 0) {
      state.morale = clamp(state.morale + 0.1, 0, 100);
    }

    updateHud();
  }

  function updateGates(scroll) {
    state.gates.forEach((gate) => {
      gate.y += scroll;
    });

    const pairIds = new Set(state.gates.map((gate) => gate.pairId));
    pairIds.forEach((pairId) => {
      if (pairApplied(pairId)) return;
      const gates = state.gates.filter((gate) => gate.pairId === pairId);
      if (!gates.length) return;
      const leadY = Math.max(...gates.map((gate) => gate.y + gate.h));
      if (leadY < PLAYER_Y - 18) return;
      applyGate(gateForPlayer(gates));
      markPair(pairId);
    });

    state.gates = state.gates.filter((gate) => gate.y < H + 80 && !pairApplied(gate.pairId));
  }

  function updateObjects(scroll, dt) {
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const ob = state.obstacles[i];
      ob.y += scroll * (ob.kind === "cucumber" ? 1.08 : 1);
      ob.spin += dt * 2;
      if (ob.hitFlash > 0) ob.hitFlash -= dt;

      const cx = ob.x + ob.w / 2;
      const overlap = Math.abs(cx - state.x) < ob.w / 2 + clamp(46 + state.cats * 0.42, 54, 118);
      if (ob.y + ob.h >= PLAYER_Y - 38 && overlap) {
        state.obstacles.splice(i, 1);
        if (ob.rewardCats) {
          addLog(`${ob.label} rolled by unopened. Unforgivable.`);
          addFloat(cx, PLAYER_Y - 70, "MISSED BOX", C.dim);
        } else {
          damageCats(ob.damage, ob.label);
          addParticles(cx, PLAYER_Y - 40, ob.color, 14);
        }
        continue;
      }

      if (ob.y > H + 110) {
        state.obstacles.splice(i, 1);
      }
    }
  }

  function updateBoss(dt) {
    const boss = state.boss;
    if (!boss) return;
    boss.phase += dt;
    boss.y = Math.min(82, boss.y + dt * 48);

    if (boss.pattern === "cucumber") {
      boss.x = W / 2 + Math.sin(boss.phase * 1.1) * 90;
    } else if (boss.pattern === "squeeze") {
      boss.x = W / 2 + Math.sin(boss.phase * 2.1) * 60;
    } else if (boss.pattern === "pointer") {
      boss.x = W / 2 + Math.sin(boss.phase * 3.2) * 240;
    } else if (boss.pattern === "bath") {
      boss.x = W / 2 + Math.sin(boss.phase * 2.4) * 130;
      boss.y = Math.min(96, boss.y + Math.sin(boss.phase * 3.1) * dt * 8);
    } else if (boss.pattern === "lint") {
      boss.x = W / 2 + Math.sin(boss.phase * 2.8) * 220;
    } else {
      boss.x = W / 2 + Math.sin(boss.phase * 1.7) * 170;
    }

    if (boss.hitFlash > 0) boss.hitFlash -= dt;
    if (state.catHitFlash > 0) state.catHitFlash -= dt;
    if (state.catScatterTimer > 0) state.catScatterTimer -= dt;

    if (boss.attackFx) {
      const fx = boss.attackFx;
      fx.ttl -= dt;
      const progress = 1 - fx.ttl / fx.maxTtl;

      if (fx.type === "vacuum" && !fx.resolved) {
        const track = fx.trackStrength ?? 2.1;
        fx.aimX += (state.x - fx.aimX) * clamp(dt * track, 0, 1);
      } else if (fx.type === "pointer" && !fx.resolved) {
        const sweep = clamp((1 - fx.ttl / fx.maxTtl) / (fx.strikeAt || 0.64), 0, 1);
        fx.dotX = fx.dotStart + (fx.dotEnd - fx.dotStart) * sweep;
      } else if (fx.type === "cucumber") {
        (fx.rollers || []).forEach((roller) => {
          roller.x += roller.vx * dt;
        });
      } else if (fx.type === "lint") {
        fx.sweepY = fx.sweepStart + (PLAYER_Y - 6 - fx.sweepStart) * clamp(progress / (fx.strikeAt || 0.7), 0, 1);
      }

      if (!fx.resolved && progress >= (fx.strikeAt ?? 0.68)) {
        resolveBossAttack(boss, fx);
      }
      if (fx.ttl <= 0) boss.attackFx = null;
    }

    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0 && !boss.attackFx) {
      boss.attackTimer += bossAttackCooldown(boss.pattern);
      beginBossAttack(boss);
    }
  }

  function updateBullets(dt) {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      if (!b) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.ttl -= dt;
      let consumed = false;

      if (state.boss && pointInBoss(b.x, b.y, state.boss)) {
        state.boss.hp -= b.damage;
        state.boss.hitFlash = 0.08;
        state.score += 5 * b.damage;
        addParticles(b.x, b.y, b.color, 4);
        consumed = true;
        if (state.boss.hp <= 0) {
          completeLevel();
          return;
        }
      }

      if (!consumed) {
        for (let j = state.obstacles.length - 1; j >= 0; j--) {
          const ob = state.obstacles[j];
          if (b.x < ob.x || b.x > ob.x + ob.w || b.y < ob.y || b.y > ob.y + ob.h) continue;
          ob.hp -= b.damage;
          ob.hitFlash = 0.08;
          addParticles(b.x, b.y, b.color, 4);
          consumed = true;
          if (ob.hp <= 0) {
            destroyObject(ob);
            state.obstacles.splice(j, 1);
          }
          break;
        }
      }

      if (consumed || b.ttl <= 0 || b.y < -40 || b.x < -80 || b.x > W + 80) {
        state.bullets.splice(i, 1);
      }
    }
  }

  function pointInBoss(x, y, boss) {
    const dx = (x - boss.x) / (boss.w / 2);
    const dy = (y - (boss.y + boss.h / 2)) / (boss.h / 2);
    return dx * dx + dy * dy <= 1.08;
  }

  function updateParticles(dt) {
    state.particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt;
      p.ttl -= dt;
    });
    state.particles = state.particles.filter((p) => p.ttl > 0);

    state.floats.forEach((f) => {
      f.y -= 42 * dt;
      f.ttl -= dt;
    });
    state.floats = state.floats.filter((f) => f.ttl > 0);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(VIEW_PAD_X, VIEW_PAD_Y);
    ctx.scale(VIEW_SCALE, VIEW_SCALE);
    drawBackground();
    state.gates.forEach(drawGate);
    state.obstacles.forEach(drawObject);
    if (state.boss) {
      drawBoss(state.boss);
      drawBossAttackFx(state.boss);
    }
    state.bullets.forEach(drawBullet);
    drawCats();
    drawParticles();
    drawFloats();
    drawTopBars();
    drawLevelBanner();
    ctx.restore();
    if (state.paused) drawPause();
  }

  function drawImageCover(image, x, y, w, h) {
    if (!imageReady(image)) return false;
    const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (image.naturalWidth - sw) / 2;
    const sy = (image.naturalHeight - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
    return true;
  }

  function drawImageContain(image, x, y, w, h) {
    if (!imageReady(image)) return false;
    const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
    const dw = image.naturalWidth * scale;
    const dh = image.naturalHeight * scale;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  function drawBackground() {
    const level = currentLevel();
    const palette = level.palette;
    if (imageReady(RASTER_ART.backdrop)) {
      ctx.save();
      drawImageCover(RASTER_ART.backdrop, 0, 0, W, H);
      const tint = ctx.createLinearGradient(0, 0, 0, H);
      tint.addColorStop(0, palette.top);
      tint.addColorStop(0.56, palette.mid);
      tint.addColorStop(1, palette.bottom);
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.03;
      ctx.fillStyle = "#05070d";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, palette.top);
      grad.addColorStop(0.55, palette.mid);
      grad.addColorStop(1, palette.bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

  }

  function drawGate(gate) {
    const alpha = pairApplied(gate.pairId) ? 0.12 : 0.88;
    const labelSize = clamp(Math.floor(gate.w * 0.055), 18, 28);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(14, 22, 34, 0.58)";
    ctx.strokeStyle = gate.color;
    ctx.lineWidth = 5;
    roundRect(gate.x, gate.y, gate.w, gate.h, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    roundRect(gate.x + 10, gate.y + 18, gate.w - 20, 54, 8);
    ctx.fill();
    fitText(gate.label, gate.x + gate.w / 2, gate.y + 52, gate.w - 24, labelSize, gate.color, "center");
    ctx.restore();
  }

  function drawObject(ob) {
    ctx.save();
    ctx.translate(ob.x + ob.w / 2, ob.y + ob.h / 2);
    if (ob.hitFlash > 0) {
      ctx.shadowColor = C.ink;
      ctx.shadowBlur = 20;
    }
    if (ob.kind === "roomba") drawRoomba(ob);
    else if (ob.kind === "cucumber") drawCucumber(ob);
    else if (ob.kind === "spray") drawSpray(ob);
    else if (ob.kind === "bath") drawBath(ob);
    else if (ob.kind === "box") drawBox(ob);
    else drawYarn(ob);
    ctx.restore();
    drawObjectHp(ob);
  }

  function drawRasterObject(kind, ob) {
    const image = RASTER_ART.objects[kind];
    if (!imageReady(image)) return false;

    ctx.save();
    ctx.shadowColor = ob.rewardCats ? "rgba(107,255,125,0.42)" : "rgba(255,94,103,0.38)";
    ctx.shadowBlur = ob.hitFlash > 0 ? 18 : 8;
    drawImageContain(image, -ob.w * 0.68, -ob.h * 0.78, ob.w * 1.36, ob.h * 1.5);
    ctx.restore();
    return true;
  }

  function drawRoomba(ob) {
    if (drawRasterObject("roomba", ob)) return;
    ctx.fillStyle = ob.color;
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(0, 0, ob.w / 2, ob.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ff6b91";
    ctx.beginPath();
    ctx.ellipse(ob.w * 0.18, -5, ob.w * 0.18, ob.h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.black;
    ctx.beginPath();
    ctx.arc(ob.w * 0.12, -8, 4, 0, Math.PI * 2);
    ctx.arc(ob.w * 0.24, -8, 4, 0, Math.PI * 2);
    ctx.fill();
    fitText("VAC", 0, 13, ob.w * 0.7, 16, C.cyan, "center");
  }

  function drawCucumber(ob) {
    if (drawRasterObject("cucumber", ob)) return;
    ctx.rotate(Math.sin(ob.spin) * 0.18);
    ctx.fillStyle = ob.color;
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 6;
    roundRect(-ob.w / 2, -ob.h / 2, ob.w, ob.h, ob.h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#d7ffd2";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-ob.w * 0.25, -ob.h * 0.14);
    ctx.quadraticCurveTo(0, ob.h * 0.08, ob.w * 0.28, -ob.h * 0.16);
    ctx.stroke();
  }

  function drawSpray(ob) {
    if (drawRasterObject("spray", ob)) return;
    ctx.fillStyle = "#9fdcff";
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 6;
    roundRect(-ob.w * 0.28, -ob.h * 0.1, ob.w * 0.56, ob.h * 0.56, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#315c82";
    roundRect(-ob.w * 0.18, -ob.h * 0.44, ob.w * 0.36, ob.h * 0.28, 8);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(ob.w * 0.16, -ob.h * 0.36 + i * 8);
      ctx.lineTo(ob.w * 0.48, -ob.h * 0.48 + i * 14);
      ctx.stroke();
    }
  }

  function drawBath(ob) {
    if (drawRasterObject("bath", ob)) return;
    ctx.fillStyle = "#2467b7";
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 6;
    roundRect(-ob.w / 2, -ob.h / 2, ob.w, ob.h, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8eefff";
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(-ob.w * 0.35 + i * ob.w * 0.18, -ob.h * 0.08 + Math.sin(ob.spin + i) * 7, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBox(ob) {
    if (drawRasterObject("box", ob)) return;
    ctx.fillStyle = ob.color;
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 6;
    roundRect(-ob.w / 2, -ob.h / 2, ob.w, ob.h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e0aa64";
    ctx.beginPath();
    ctx.moveTo(-ob.w / 2, -ob.h / 2);
    ctx.lineTo(0, -ob.h * 0.78);
    ctx.lineTo(ob.w / 2, -ob.h / 2);
    ctx.lineTo(0, -ob.h * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawTinyCat(-16, 8, 0.5, "#f5f0de");
    drawTinyCat(24, 6, 0.45, "#f6a94d");
  }

  function drawYarn(ob) {
    if (drawRasterObject("yarn", ob)) return;
    ctx.fillStyle = ob.color;
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(ob.w, ob.h) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#fff3fa";
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, ob.w * 0.28, ob.h * 0.1, ob.spin + i * 0.75, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawObjectHp(ob) {
    if (ob.hp >= ob.maxHp) return;
    const x = ob.x;
    const y = ob.y - 12;
    ctx.fillStyle = "rgba(0,0,0,0.48)";
    roundRect(x, y, ob.w, 7, 3);
    ctx.fill();
    ctx.fillStyle = ob.rewardCats ? C.green : C.red;
    roundRect(x, y, ob.w * clamp(ob.hp / ob.maxHp, 0, 1), 7, 3);
    ctx.fill();
  }

  function drawBoss(boss) {
    ctx.save();
    ctx.translate(boss.x, boss.y + boss.h / 2);
    if (boss.hitFlash > 0) {
      ctx.shadowColor = C.ink;
      ctx.shadowBlur = 24;
    }
    const bossArt = RASTER_ART.objects[
      boss.pattern === "cucumber" ? "cucumber" : boss.pattern === "bath" ? "bath" : boss.pattern === "pointer" ? "laser" : "vacuum"
    ];
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 8;
    if (imageReady(bossArt)) {
      ctx.save();
      ctx.rotate(Math.sin(boss.phase) * 0.05);
      ctx.shadowColor = boss.accent || C.pink;
      ctx.shadowBlur = 14;
      drawImageContain(bossArt, -boss.w * 0.62, -boss.h * 0.82, boss.w * 1.24, boss.h * 1.58);
      ctx.restore();
    } else {
      ctx.fillStyle = boss.color || "#212838";
      ctx.beginPath();
      ctx.ellipse(0, 0, boss.w / 2, boss.h / 2, Math.sin(boss.phase) * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#334159";
      ctx.beginPath();
      ctx.ellipse(-46, -10, 48, 26, -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = boss.accent || C.yellow;
      ctx.beginPath();
      ctx.ellipse(58, -10, 50, 29, 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.black;
      ctx.beginPath();
      ctx.arc(46, -16, 6, 0, Math.PI * 2);
      ctx.arc(74, -16, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(5, 18, 62, 0.2, Math.PI - 0.2, false);
      ctx.stroke();
    }
    fitText(boss.label || "BOSS", 0, 58, boss.w * 0.78, 18, C.yellow, "center");
    ctx.restore();

    const pct = clamp(boss.hp / boss.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(220, 18, 520, 16, 8);
    ctx.fill();
    ctx.fillStyle = boss.accent || C.pink;
    roundRect(220, 18, 520 * pct, 16, 8);
    ctx.fill();
    fitText(boss.caption || "BOSS PHASE", 480, 51, 360, 17, C.ink, "center");
  }

  function drawBossAttackFx(boss) {
    const fx = boss.attackFx;
    if (!fx) return;
    if (fx.type === "cucumber") drawCucumberBossAttack(boss, fx);
    else if (fx.type === "bath") drawBathBossAttack(boss, fx);
    else if (fx.type === "lint") drawLintBossAttack(boss, fx);
    else if (fx.type === "squeeze") drawSqueezeBossAttack(boss, fx);
    else if (fx.type === "pointer") drawPointerBossAttack(boss, fx);
    else drawVacuumBossAttack(boss, fx);
  }

  function drawVacuumBossAttack(boss, fx) {
    const progress = clamp(1 - fx.ttl / fx.maxTtl, 0, 1);
    const fromX = boss.x;
    const fromY = boss.y + boss.h / 2;
    const aimX = fx.aimX ?? state.x;
    const toY = fx.targetY ?? PLAYER_Y - 24;
    const aimRadius = fx.aimRadius ?? BOSS_ATTACK_AIM_RADIUS;
    const dodgeDist = aimRadius + (fx.dodgeMargin ?? BOSS_ATTACK_DODGE_MARGIN);
    const playerSafe = Math.abs(state.x - aimX) > dodgeDist;
    const pulse = 0.55 + Math.sin(progress * Math.PI * 5) * 0.18;
    const zoneRadius = 28 + progress * aimRadius;

    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = playerSafe ? "rgba(46, 224, 255, 0.72)" : "rgba(255, 94, 103, 0.88)";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.55 + progress * 0.35;
    ctx.beginPath();
    ctx.ellipse(aimX, PLAYER_Y + 8, zoneRadius * 1.08, zoneRadius * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const beam = ctx.createLinearGradient(fromX, fromY, aimX, toY);
    beam.addColorStop(0, boss.accent || C.purple);
    beam.addColorStop(0.45, "rgba(255,255,255,0.72)");
    beam.addColorStop(1, playerSafe ? "rgba(46,224,255,0.72)" : "rgba(255,94,103,0.92)");
    ctx.strokeStyle = beam;
    ctx.lineWidth = 8 + progress * 12;
    ctx.globalAlpha = (0.42 + progress * 0.45) * pulse;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    const midX = fromX + (aimX - fromX) * 0.52 + Math.sin(progress * Math.PI * 2) * 18;
    const midY = fromY + (toY - fromY) * 0.52;
    ctx.quadraticCurveTo(midX, midY, aimX, toY);
    ctx.stroke();
    ctx.fillStyle = playerSafe ? "rgba(46, 224, 255, 0.14)" : "rgba(255, 94, 103, 0.24)";
    ctx.globalAlpha = 0.55 + progress * 0.35;
    ctx.beginPath();
    ctx.ellipse(aimX, PLAYER_Y + 8, zoneRadius * 1.08, zoneRadius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCucumberBossAttack(boss, fx) {
    const progress = clamp(1 - fx.ttl / fx.maxTtl, 0, 1);
    ctx.save();
    ctx.strokeStyle = "rgba(120, 255, 120, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(0, PLAYER_Y + 6);
    ctx.lineTo(W, PLAYER_Y + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    (fx.rollers || []).forEach((roller) => {
      const safe = Math.abs(state.x - roller.x) >= 58;
      ctx.save();
      ctx.translate(roller.x, roller.y);
      ctx.fillStyle = safe ? "#45c966" : "#ff5e67";
      ctx.strokeStyle = C.black;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, roller.w / 2, roller.h / 2, roller.vx > 0 ? 0.12 : -0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#2f9b4d";
      ctx.beginPath();
      ctx.ellipse(-8, -4, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35 + progress * 0.45;
      ctx.strokeStyle = boss.accent || C.green;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(roller.vx > 0 ? -roller.w : roller.w, 0);
      ctx.lineTo(roller.vx > 0 ? -roller.w - 48 : roller.w + 48, 0);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawBathBossAttack(boss, fx) {
    const progress = clamp(1 - fx.ttl / fx.maxTtl, 0, 1);
    const laneW = W / 3;
    const lanes = [
      { id: "left", x: 0, w: laneW },
      { id: "center", x: laneW, w: laneW },
      { id: "right", x: laneW * 2, w: laneW },
    ];
    const floodH = (PLAYER_Y + 40) * progress;

    lanes.forEach((lane) => {
      const dry = lane.id === fx.dryLane;
      const here = playerLane() === lane.id;
      ctx.save();
      ctx.fillStyle = dry ? "rgba(46, 224, 255, 0.16)" : "rgba(55, 166, 255, 0.34)";
      ctx.globalAlpha = dry ? 0.55 + progress * 0.35 : 0.35 + progress * 0.55;
      ctx.fillRect(lane.x + 8, PLAYER_Y + 36 - floodH, lane.w - 16, floodH);
      ctx.strokeStyle = dry ? C.cyan : boss.accent || C.cyan;
      ctx.lineWidth = dry ? 4 : 2;
      ctx.strokeRect(lane.x + 8, PLAYER_Y + 36 - floodH, lane.w - 16, floodH);
      if (dry) fitText("DRY", lane.x + lane.w / 2, PLAYER_Y - 24 - progress * 18, lane.w - 24, 18, C.cyan, "center");
      else if (here && !fx.resolved) fitText("SPLASH", lane.x + lane.w / 2, PLAYER_Y - 12, lane.w - 24, 16, "#9ed8ff", "center");
      ctx.restore();
    });
  }

  function drawSqueezeBossAttack(boss, fx) {
    const progress = clamp(1 - fx.ttl / fx.maxTtl, 0, 1);
    const laneW = W / 3;
    const lanes = [
      { id: "left", x: 0, w: laneW },
      { id: "center", x: laneW, w: laneW },
      { id: "right", x: laneW * 2, w: laneW },
    ];
    const floodH = (PLAYER_Y + 40) * progress;
    lanes.forEach((lane) => {
      const safe = lane.id === "center";
      const here = playerLane() === lane.id;
      ctx.save();
      ctx.fillStyle = safe ? "rgba(46, 224, 255, 0.16)" : "rgba(255, 94, 103, 0.34)";
      ctx.globalAlpha = safe ? 0.55 + progress * 0.35 : 0.4 + progress * 0.55;
      ctx.fillRect(lane.x + 8, PLAYER_Y + 36 - floodH, lane.w - 16, floodH);
      ctx.strokeStyle = safe ? C.cyan : boss.accent || C.red;
      ctx.lineWidth = safe ? 4 : 2;
      ctx.strokeRect(lane.x + 8, PLAYER_Y + 36 - floodH, lane.w - 16, floodH);
      if (safe) fitText("SAFE", lane.x + lane.w / 2, PLAYER_Y - 24 - progress * 18, lane.w - 24, 18, C.cyan, "center");
      else if (here && !fx.resolved) fitText("BLAST", lane.x + lane.w / 2, PLAYER_Y - 12, lane.w - 24, 16, "#ff9b9b", "center");
      ctx.restore();
    });
  }

  function drawPointerBossAttack(boss, fx) {
    const progress = clamp(1 - fx.ttl / fx.maxTtl, 0, 1);
    const dotX = fx.dotX ?? state.x;
    const hitRadius = fx.hitRadius || 48;
    const safe = Math.abs(state.x - dotX) > hitRadius;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 59, 92, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(fx.dotStart, PLAYER_Y + 10);
    ctx.lineTo(fx.dotEnd, PLAYER_Y + 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = safe ? "rgba(46, 224, 255, 0.14)" : "rgba(255, 59, 92, 0.28)";
    ctx.beginPath();
    ctx.arc(dotX, PLAYER_Y + 8, hitRadius * (0.72 + progress * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = safe ? C.cyan : "#ff2244";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#ff2244";
    ctx.beginPath();
    ctx.arc(dotX, PLAYER_Y + 8, 8 + progress * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    fitText(safe ? "OFF THE DOT" : "MOVE!", dotX, PLAYER_Y - 28, 120, 16, safe ? C.cyan : "#ff2244", "center");
    ctx.restore();
  }

  function drawLintBossAttack(boss, fx) {
    const progress = clamp(1 - fx.ttl / fx.maxTtl, 0, 1);
    const sweepY = fx.sweepY ?? (fx.sweepStart + (PLAYER_Y - fx.sweepStart) * progress);
    const gapX = fx.gapX;
    const gapHalf = fx.gapWidth / 2;
    const safe = Math.abs(state.x - gapX) <= gapHalf - 8;
    const barH = 34;

    ctx.save();
    ctx.fillStyle = boss.color || "#311d55";
    ctx.globalAlpha = 0.88;
    if (gapX - gapHalf > 0) ctx.fillRect(0, sweepY - barH / 2, gapX - gapHalf, barH);
    if (gapX + gapHalf < W) ctx.fillRect(gapX + gapHalf, sweepY - barH / 2, W - (gapX + gapHalf), barH);
    ctx.fillStyle = boss.accent || C.yellow;
    ctx.fillRect(gapX - gapHalf, sweepY - barH / 2, fx.gapWidth, 8);
    ctx.fillRect(gapX - gapHalf, sweepY + barH / 2 - 8, fx.gapWidth, 8);
    ctx.strokeStyle = safe ? C.cyan : C.red;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(gapX - gapHalf, sweepY - barH / 2, fx.gapWidth, barH);
    ctx.setLineDash([]);
    fitText(safe ? "SAFE GAP" : "MOVE!", gapX, sweepY + 5, fx.gapWidth - 20, 16, safe ? C.cyan : C.red, "center");
    ctx.restore();
  }

  function drawBullet(b) {
    ctx.save();
    ctx.fillStyle = b.color;
    ctx.strokeStyle = b.color;
    if (b.kind === "laser") {
      ctx.globalAlpha = 0.86;
      ctx.lineWidth = 3;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + 12);
      ctx.lineTo(b.x - b.vx * 0.035, b.y - 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.shadowColor = "#fff2d6";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#9b7b55";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCats() {
    const visible = Math.min(Math.max(0, Math.round(state.cats)), 48);
    const moraleBob = (100 - state.morale) * 0.08;
    const scatter = state.catScatterTimer > 0 ? state.catScatterTimer / 0.42 : 0;
    if (state.catHitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(state.catHitFlash / 0.34, 0, 0.42) * 0.55;
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.ellipse(state.x, PLAYER_Y + 18, clamp(64 + state.cats * 0.45, 70, 138), 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = C.black;
    ctx.beginPath();
    ctx.ellipse(state.x, PLAYER_Y + 22, clamp(62 + state.cats * 0.44, 68, 126), 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (let i = visible - 1; i >= 0; i--) {
      const angle = i * 2.399963 + state.time * 0.45;
      const radius = 12 + Math.sqrt(i + 1) * 11.5;
      const scatterX = scatter * Math.sin(i * 1.73 + state.time * 18) * 22 * (1 + (i % 3) * 0.18);
      const scatterY = scatter * Math.cos(i * 2.19 + state.time * 16) * 14;
      const x = clamp(state.x + Math.cos(angle) * radius + scatterX, PLAY_MIN_X - 18, PLAY_MAX_X + 18);
      const y = PLAYER_Y + Math.sin(angle) * radius * 0.38 + ((i % 5) - 2) * 5 + Math.sin(state.time * 7 + i) * (1.5 + moraleBob) + scatterY;
      drawTinyCat(x, y, clamp(0.72 - i * 0.004, 0.46, 0.72), CAT_FURS[i % CAT_FURS.length], angle, i);
    }

    if (state.cats > visible) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
      roundRect(state.x + 44, PLAYER_Y + 28, 86, 38, 8);
      ctx.fill();
      fitText(`+${Math.round(state.cats - visible)}`, state.x + 87, PLAYER_Y + 53, 70, 22, C.yellow, "center");
    }

  }

  function drawTinyCat(x, y, scale, fur, angle, artIndex = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin((angle || 0) + state.time * 2) * 0.08);
    ctx.scale(scale, scale);
    const catArt = RASTER_ART.cats[Math.abs(artIndex) % RASTER_ART.cats.length];
    if (imageReady(catArt)) {
      drawRasterCat(catArt);
      ctx.restore();
      return;
    }
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = fur;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-24, 18);
    ctx.quadraticCurveTo(-42, -2, -25, -19);
    ctx.stroke();

    ctx.fillStyle = fur;
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(0, 8, 25, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(5, -12, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-8, -26);
    ctx.lineTo(-17, -45);
    ctx.lineTo(3, -31);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(17, -24);
    ctx.lineTo(30, -42);
    ctx.lineTo(29, -18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.black;
    ctx.beginPath();
    ctx.arc(-3, -13, 3.2, 0, Math.PI * 2);
    ctx.arc(15, -14, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.pink;
    ctx.beginPath();
    ctx.moveTo(6, -6);
    ctx.lineTo(13, -6);
    ctx.lineTo(10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRasterCat(image) {
    ctx.save();
    drawImageContain(image, -50, -60, 100, 112);
    ctx.restore();
  }

  function drawParticles() {
    state.particles.forEach((p) => {
      const alpha = clamp(p.ttl / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.kind === "cat") {
        ctx.ellipse(p.x, p.y, p.r * 1.15, p.r * 0.82, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    });
  }

  function drawFloats() {
    state.floats.forEach((f) => {
      const alpha = clamp(f.ttl / f.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      fitText(f.text, f.x, f.y, 240, 24, f.color, "center");
      ctx.restore();
    });
  }

  function drawTopBars() {
    const level = currentLevel();
    const pct = levelProgress();
    const distance = state.boss ? "BOSS" : `${Math.round(pct * 100)}%`;
    ctx.save();

    ctx.fillStyle = "rgba(3, 6, 11, 0.66)";
    roundRect(18, 16, W - 36, 58, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(251,250,244,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();

    drawHudStat(34, 28, 122, "SCORE", Math.round(state.score).toLocaleString(), C.yellow);
    drawHudStat(168, 28, 92, "LEVEL", `${levelNumber()}/${LEVELS.length}`, level.bossAccent || C.green);
    drawHudStat(708, 28, 90, "CATS", Math.max(0, Math.round(state.cats)).toLocaleString(), C.yellow);
    drawHudStat(810, 28, 112, "MORALE", `${Math.max(0, Math.round(state.morale))}%`, state.morale > 34 ? C.green : C.red);

    ctx.fillStyle = "rgba(0,0,0,0.42)";
    roundRect(282, 28, 404, 30, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(251,250,244,0.12)";
    roundRect(298, 48, 244, 6, 3);
    ctx.fill();
    ctx.fillStyle = level.bossAccent || C.green;
    roundRect(298, 48, 244 * pct, 6, 3);
    ctx.fill();
    fitText(level.short.toUpperCase(), 406, 41, 190, 15, C.ink, "center");
    fitText(distance, 620, 41, 100, 15, state.boss ? C.red : C.cyan, "center");
    ctx.restore();
  }

  function drawHudStat(x, y, width, label, value, color) {
    ctx.fillStyle = "rgba(0,0,0,0.36)";
    roundRect(x, y, width, 30, 8);
    ctx.fill();
    fitText(label, x + 10, y + 10, width - 20, 9, "rgba(251,250,244,0.62)", "left");
    fitText(value, x + 10, y + 23, width - 20, 15, color, "left");
  }

  function drawLevelBanner() {
    if (state.levelBanner <= 0 || state.mode !== "playing") return;
    const level = currentLevel();
    const alpha = clamp(state.levelBanner / 2.8, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(0.92, alpha);
    ctx.fillStyle = "rgba(3, 6, 11, 0.62)";
    roundRect(238, 82, 484, 78, 10);
    ctx.fill();
    fitText(`LEVEL ${levelNumber()} / ${LEVELS.length}`, W / 2, 112, 320, 20, level.bossAccent || C.yellow, "center");
    fitText(level.name.toUpperCase(), W / 2, 142, 430, 24, C.ink, "center");
    ctx.restore();
  }

  function drawPause() {
    ctx.save();
    ctx.fillStyle = "rgba(3, 6, 11, 0.58)";
    ctx.fillRect(0, 0, W, H);
    fitText("PAUSED", W / 2, H / 2, 300, 42, C.yellow, "center");
    ctx.restore();
  }

  function fitText(text, x, y, maxWidth, maxSize, color, align) {
    ctx.save();
    ctx.fillStyle = color || C.ink;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${maxSize}px 'JetBrains Mono', monospace`;
    let size = maxSize;
    while (ctx.measureText(text).width > maxWidth && size > 9) {
      size -= 1;
      ctx.font = `800 ${size}px 'JetBrains Mono', monospace`;
    }
    ctx.lineWidth = Math.max(3, size * 0.12);
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function pointerToWorld(clientX) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
    return (canvasX - VIEW_PAD_X) / VIEW_SCALE;
  }

  function setPointerTarget(clientX) {
    state.targetX = clamp(pointerToWorld(clientX), PLAY_MIN_X, PLAY_MAX_X);
  }

  canvas.addEventListener("pointerdown", (event) => {
    input.pointer = true;
    setPointerTarget(event.clientX);
    canvas.setPointerCapture(event.pointerId);
    if (state.mode !== "playing") newGame();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!input.pointer) return;
    setPointerTarget(event.clientX);
  });

  canvas.addEventListener("pointerup", (event) => {
    input.pointer = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (_) {}
  });

  canvas.addEventListener("pointercancel", () => {
    input.pointer = false;
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      togglePause();
      return;
    }
    if ((event.key === " " || event.key === "Enter") && state.mode !== "playing") {
      event.preventDefault();
      newGame();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      event.preventDefault();
      input.left = true;
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      event.preventDefault();
      input.right = true;
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") input.left = false;
    if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") input.right = false;
  });

  document.querySelectorAll("[data-clowder-dir]").forEach((button) => {
    const dir = button.getAttribute("data-clowder-dir");
    const set = (value) => {
      if (dir === "left") input.left = value;
      if (dir === "right") input.right = value;
      if (dir === "center" && value) state.targetX = W / 2;
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (state.mode !== "playing") newGame();
      set(true);
    });
    button.addEventListener("pointerup", () => set(false));
    button.addEventListener("pointerleave", () => set(false));
    button.addEventListener("click", () => {
      if (dir === "center") state.targetX = W / 2;
    });
  });

  if (btnPrimary) btnPrimary.addEventListener("click", newGame);
  if (btnNew) btnNew.addEventListener("click", newGame);
  if (btnPause) btnPause.addEventListener("click", togglePause);
  if (btnSound) btnSound.addEventListener("click", toggleSound);
  if (btnFullscreen && wrap) {
    btnFullscreen.addEventListener("click", () => {
      const active = !wrap.classList.contains("is-maxed");
      wrap.classList.toggle("is-maxed", active);
      document.body.classList.toggle("rb-game-maxed", active);
      btnFullscreen.textContent = active ? "Exit" : "Max";
      setTimeout(draw, 60);
    });
  }

  function snapshot() {
    return {
      mode: state.mode,
      started: state.started,
      paused: state.paused,
      x: state.x,
      targetX: state.targetX,
      levelIndex: state.levelIndex,
      cats: state.cats,
      morale: state.morale,
      score: state.score,
      distance: state.distance,
      speed: state.speed,
      time: state.time,
      combo: state.combo,
      fireTimer: state.fireTimer,
      nextGateAt: state.nextGateAt,
      nextObjectAt: state.nextObjectAt,
      nextPairId: state.nextPairId,
      appliedPairs: state.appliedPairs.slice(),
      bossSpawned: state.bossSpawned,
      boss: state.boss ? { ...state.boss } : null,
      gates: state.gates.map((gate) => ({ ...gate })),
      obstacles: state.obstacles.map((ob) => ({ ...ob })),
      bullets: state.bullets.map((bullet) => ({ ...bullet })),
      particles: state.particles.map((p) => ({ ...p })),
      floats: state.floats.map((f) => ({ ...f })),
      levelBanner: state.levelBanner,
      log: state.log.slice(0, 5),
    };
  }

  function saveProgress() {
    if (!saveSlot || state.mode !== "playing") return;
    saveSlot.save(snapshot());
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data || data.mode !== "playing") return;
    state = resetRuntimeArrays({ ...makeInitialState(), ...data });
    state.mode = "playing";
    state.started = true;
    bestAtStart = api.getHighScore(GAME_ID);
    hideOverlay();
    updateHud();
    renderLog();
    draw();
    lastT = performance.now();
    canvas.focus({ preventScroll: true });
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);
    update(dt);
    draw();
  }

  function showStartOverlay() {
    showOverlay({
      title: GAME_TITLE.toUpperCase(),
      body:
        `Take a pack of extremely ungovernable cats through ${LEVELS.length} levels of household nonsense. Hit the good gates, delete the hazards, and survive eight appliance bosses.`,
      score: `High score: <strong>${api.getHighScore(GAME_ID).toLocaleString()}</strong>`,
      button: "Start level 1",
    });
  }

  function init() {
    setSoundLabel();
    renderLog();
    updateHud();
    showStartOverlay();
    lastT = performance.now();
    rafId = requestAnimationFrame(frame);
    if (saveSlot) {
      saveMenu = saveSlot.attachButtons({
        primary: btnPrimary,
        scoreEl: overlayScore,
        continueLabel: "Continue",
        newLabel: "New run",
        onContinue: restoreGame,
        summary: (saved) => {
          const data = saved.data || {};
          const level = LEVELS[clamp(Math.round(Number(data.levelIndex) || 0), 0, LEVELS.length - 1)];
          return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Level <strong>${level.short}</strong> · Cats <strong>${Math.round(Number(data.cats || 0)).toLocaleString()}</strong>`;
        },
      });
      saveSlot.startAutosave(snapshot, () => state.mode === "playing");
      saveMenu.refresh();
    }
    draw();
  }

  window.__CLOWDER = {
    start: newGame,
    pause: togglePause,
    save: saveProgress,
    restore: () => restoreGame(saveSlot && saveSlot.read()),
    gate: spawnGatePair,
    object: spawnObject,
    boss: spawnBoss,
    cats: (n) => {
      state.cats = clamp(Number(n) || state.cats, 0, MAX_CATS);
      updateHud();
    },
    setDistance: (value) => {
      state.distance = clamp(Number(value) || 0, 0, currentLevel().length);
      updateHud();
    },
    setLevel: (value) => {
      state.levelIndex = clamp((Number(value) || 1) - 1, 0, LEVELS.length - 1);
      state.distance = 0;
      state.boss = null;
      state.speed = currentLevel().speed;
      state.levelBanner = 1.8;
      updateHud();
    },
    get state() {
      return snapshot();
    },
    get running() {
      return state.mode === "playing" && !state.paused;
    },
  };

  init();
})();
