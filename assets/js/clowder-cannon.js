/* ============================================
   DONT F*CK WITH CATS
   - Cat-swarm runner parody with gates, auto-fire, and a vacuum boss.
   - Debug hook: window.__CLOWDER
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "dont-fck-with-cats";
  const GAME_TITLE = "Dont F*ck with Cats";
  const W = 960;
  const H = 600;
  const PLAYER_Y = 498;
  const START_CATS = 12;
  const MAX_CATS = 128;
  const LEVELS = [
    {
      name: "Living Room Uprising",
      short: "Living Room",
      length: 2550,
      speed: 222,
      bossSpeed: 108,
      bossLabel: "Deluxe Vacuum",
      bossCaption: "VACUUM AUTHORITY",
      bossHp: 170,
      bossDamage: 4,
      bossColor: "#212838",
      bossAccent: "#ff2e88",
      gateEvery: [500, 660],
      objectEvery: [170, 265],
      hpMod: 1,
      damageMod: 1,
      clearBonus: 1100,
      intro: "Level 1: the living room has declared martial law.",
      palette: { top: "#071326", mid: "#111c2d", bottom: "#0b1422", glowA: "#2ee0ff", glowB: "#ff2e88" },
    },
    {
      name: "Kitchen Counter Siege",
      short: "Kitchen",
      length: 2950,
      speed: 250,
      bossSpeed: 118,
      bossLabel: "Cucumber Warlord",
      bossCaption: "UNLICENSED PRODUCE",
      bossHp: 230,
      bossDamage: 5,
      bossColor: "#245f37",
      bossAccent: "#8cff72",
      gateEvery: [455, 610],
      objectEvery: [138, 225],
      hpMod: 1.16,
      damageMod: 1.12,
      clearBonus: 1500,
      intro: "Level 2: the kitchen counter is all traps, no snacks.",
      palette: { top: "#0d1e19", mid: "#17301f", bottom: "#101421", glowA: "#6bff7d", glowB: "#ffd43b" },
    },
    {
      name: "Vet Lobby Ambush",
      short: "Vet Lobby",
      length: 3350,
      speed: 276,
      bossSpeed: 126,
      bossLabel: "Bath Protocol",
      bossCaption: "WETNESS COMPLIANCE",
      bossHp: 300,
      bossDamage: 7,
      bossColor: "#1d5485",
      bossAccent: "#6dc8ff",
      gateEvery: [420, 570],
      objectEvery: [118, 196],
      hpMod: 1.34,
      damageMod: 1.25,
      clearBonus: 2050,
      intro: "Level 3: the vet lobby smells like betrayal.",
      palette: { top: "#08172c", mid: "#102d4c", bottom: "#0e1421", glowA: "#6dc8ff", glowB: "#ff6f91" },
    },
    {
      name: "Internet Comments Finale",
      short: "Comments",
      length: 3800,
      speed: 302,
      bossSpeed: 136,
      bossLabel: "Algorithmic Lint Roller",
      bossCaption: "ENGAGEMENT FARM",
      bossHp: 390,
      bossDamage: 9,
      bossColor: "#311d55",
      bossAccent: "#ffd43b",
      gateEvery: [380, 520],
      objectEvery: [95, 170],
      hpMod: 1.55,
      damageMod: 1.42,
      clearBonus: 3000,
      intro: "Level 4: the comment section has found the cats.",
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

  const GATE_POOL = [
    { type: "add", value: 10, label: "+10 KITTENS", good: true, color: C.green },
    { type: "add", value: 6, label: "+6 BOX CATS", good: true, color: C.cyan },
    { type: "multiply", value: 2, label: "x2 ZOOMIES", good: true, color: C.yellow },
    { type: "morale", value: 20, label: "+20 MORALE", good: true, color: "#9cffef" },
    { type: "subtract", value: 8, label: "-8 BATH", good: false, color: C.red },
    { type: "divide", value: 2, label: "/2 CUCUMBER", good: false, color: "#7ad65f" },
    { type: "subtract", value: 12, label: "-12 VET BILL", good: false, color: "#ff965e" },
    { type: "morale", value: -28, label: "-28 VACUUM", good: false, color: "#ff6f91" },
  ];

  const OBJECT_POOL = [
    { kind: "roomba", label: "ROOMBA", hp: 8, damage: 6, score: 110, w: 112, h: 58, color: "#26364f" },
    { kind: "cucumber", label: "CUCUMBER", hp: 4, damage: 4, score: 70, w: 92, h: 54, color: "#45c966" },
    { kind: "spray", label: "SPRAY", hp: 6, damage: 7, score: 90, w: 78, h: 88, color: "#6dc8ff" },
    { kind: "bath", label: "BATH WATER", hp: 7, damage: 9, score: 120, w: 132, h: 62, color: "#37a6ff" },
    { kind: "box", label: "+4 BOX CATS", hp: 5, damage: 0, rewardCats: 4, score: 80, w: 118, h: 72, color: "#bd7a3a" },
    { kind: "yarn", label: "+2 YARN CREW", hp: 3, damage: 0, rewardCats: 2, score: 60, w: 76, h: 76, color: "#ffb1d6" },
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
      nextGateAt: 230,
      nextObjectAt: 110,
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
        ? "Four levels of household nonsense have been reduced to apologetic debris. The cats accept no interviews and several treats."
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

  function spawnGatePair() {
    const level = currentLevel();
    const pairId = state.nextPairId++;
    const positive = pick(GATE_POOL.filter((g) => g.good));
    let other = pick(GATE_POOL);
    if (Math.random() < 0.46 + state.levelIndex * 0.08) other = pick(GATE_POOL.filter((g) => !g.good));
    if (other.label === positive.label) other = pick(GATE_POOL.filter((g) => g.label !== positive.label));
    const leftFirst = Math.random() > 0.5;
    const specs = leftFirst ? [positive, other] : [other, positive];
    const xs = [142, 598];
    specs.forEach((spec, i) => {
      state.gates.push({
        ...spec,
        pairId,
        x: xs[i],
        y: -112,
        w: 220,
        h: 92,
        levelName: level.short,
      });
    });
  }

  function spawnObject() {
    const level = currentLevel();
    const spec = { ...pick(OBJECT_POOL) };
    const lanes = [170, 300, 430, 560, 690, 810];
    const x = clamp(pick(lanes) + rand(-34, 34) - spec.w / 2, 40, W - spec.w - 40);
    const levelScale = 1 + state.levelIndex * 0.055;
    const scale = (spec.kind === "roomba" && state.distance > level.length * 0.55 ? 1.16 : 1) * levelScale;
    state.obstacles.push({
      ...spec,
      x,
      y: -120,
      w: spec.w * scale,
      h: spec.h * scale,
      hp: Math.ceil(spec.hp * scale * level.hpMod),
      maxHp: Math.ceil(spec.hp * scale * level.hpMod),
      damage: Math.ceil(spec.damage * level.damageMod),
      score: Math.ceil(spec.score * (1 + state.levelIndex * 0.22)),
      rewardCats: spec.rewardCats ? spec.rewardCats + (state.levelIndex >= 2 ? 1 : 0) : 0,
      spin: rand(0, Math.PI * 2),
      hitFlash: 0,
    });
  }

  function spawnBoss() {
    const level = currentLevel();
    state.bossSpawned = true;
    state.speed = level.bossSpeed;
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
      attackTimer: 1.4,
      phase: 0,
      hitFlash: 0,
    };
    state.gates.length = 0;
    addLog(`${level.bossLabel} entered ${level.short}.`);
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
      state.cats = clamp(Math.round(state.cats * gate.value), 0, MAX_CATS);
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

  function damageCats(amount, source) {
    if (amount <= 0 || state.mode !== "playing") return;
    const loss = Math.min(state.cats, Math.ceil(amount));
    state.cats = clamp(state.cats - loss, 0, MAX_CATS);
    state.morale = clamp(state.morale - amount * 1.6, 0, 100);
    state.combo = 0;
    addFloat(state.x, PLAYER_Y - 72, `-${loss} CATS`, C.red);
    addLog(`${source} scattered ${loss} cat${loss === 1 ? "" : "s"}.`);
    sfx("gateBad");
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
    state.nextGateAt = 210;
    state.nextObjectAt = 100;
    state.cats = clamp(state.cats + 5 + state.levelIndex * 2, 1, MAX_CATS);
    state.morale = clamp(state.morale + 16, 0, 100);
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
    const count = clamp(1 + Math.floor(state.cats / 18), 1, 8);
    const spread = clamp(22 + state.cats * 0.55, 28, 104);
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
    state.targetX = clamp(state.targetX, 92, W - 92);
    state.x += (state.targetX - state.x) * clamp(dt * 9.5, 0, 1);
    state.x = clamp(state.x, 88, W - 88);

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
    const fireEvery = clamp(0.17 - state.cats * 0.00115, 0.055, 0.17);
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
      state.morale = clamp(state.morale + 0.25, 0, 100);
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
      const hit = gates.find((gate) => state.x >= gate.x && state.x <= gate.x + gate.w);
      if (hit) applyGate(hit);
      else {
        state.morale = clamp(state.morale - 2, 0, 100);
        addLog("The cats ignored both gates and called it strategy.");
      }
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
    boss.x = W / 2 + Math.sin(boss.phase * 1.7) * 170;
    if (boss.hitFlash > 0) boss.hitFlash -= dt;

    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      boss.attackTimer += rand(1.08, 1.58) - state.levelIndex * 0.08;
      const loss = Math.max(2, Math.floor(boss.damage + (1 - boss.hp / boss.maxHp) * (4 + state.levelIndex)));
      damageCats(loss, boss.label || "Boss");
      addParticles(boss.x, boss.y + boss.h, boss.accent || C.purple, 18);
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
    drawBackground();
    state.gates.forEach(drawGate);
    state.obstacles.forEach(drawObject);
    if (state.boss) drawBoss(state.boss);
    state.bullets.forEach(drawBullet);
    drawCats();
    drawParticles();
    drawFloats();
    drawTopBars();
    drawLevelBanner();
    if (state.paused) drawPause();
  }

  function drawBackground() {
    const offset = (state.distance * 0.45) % 70;
    const level = currentLevel();
    const palette = level.palette;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, palette.top);
    grad.addColorStop(0.55, palette.mid);
    grad.addColorStop(1, palette.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#304b6f";
    ctx.lineWidth = 2;
    for (let y = -70 + offset; y < H + 70; y += 70) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y - 18);
      ctx.stroke();
    }
    ctx.strokeStyle = "#1c3453";
    for (let i = 0; i < 7; i++) {
      const x = 90 + i * 130;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (i - 3) * 40, H);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = palette.glowA;
    ctx.beginPath();
    ctx.arc(120, 80, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.glowB;
    ctx.beginPath();
    ctx.arc(870, 42, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    fitText(level.name.toUpperCase(), W - 28, 34, 360, 18, "rgba(251,250,244,0.72)", "right");
  }

  function drawGate(gate) {
    const alpha = pairApplied(gate.pairId) ? 0.12 : 0.88;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gate.good ? "rgba(36, 255, 145, 0.12)" : "rgba(255, 84, 103, 0.13)";
    ctx.strokeStyle = gate.color;
    ctx.lineWidth = 6;
    roundRect(gate.x, gate.y, gate.w, gate.h, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    roundRect(gate.x + 12, gate.y + 20, gate.w - 24, 52, 8);
    ctx.fill();
    fitText(gate.label, gate.x + gate.w / 2, gate.y + 54, gate.w - 32, 25, gate.color, "center");
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

  function drawRoomba(ob) {
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
    ctx.fillStyle = boss.color || "#212838";
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(0, 0, boss.w / 2, boss.h / 2, Math.sin(boss.phase) * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#334159";
    ctx.beginPath();
    ctx.ellipse(-46, -10, 48, 26, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = boss.accent || C.pink;
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
    fitText(boss.label || "BOSS", 0, 48, boss.w * 0.78, 18, C.yellow, "center");
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
    for (let i = visible - 1; i >= 0; i--) {
      const angle = i * 2.399963 + state.time * 0.45;
      const radius = 12 + Math.sqrt(i + 1) * 11.5;
      const x = clamp(state.x + Math.cos(angle) * radius, 22, W - 22);
      const y = PLAYER_Y + Math.sin(angle) * radius * 0.38 + ((i % 5) - 2) * 5 + Math.sin(state.time * 7 + i) * (1.5 + moraleBob);
      drawTinyCat(x, y, clamp(0.72 - i * 0.004, 0.46, 0.72), CAT_FURS[i % CAT_FURS.length], angle);
    }

    if (state.cats > visible) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
      roundRect(state.x + 44, PLAYER_Y + 28, 86, 38, 8);
      ctx.fill();
      fitText(`+${Math.round(state.cats - visible)}`, state.x + 87, PLAYER_Y + 53, 70, 22, C.yellow, "center");
    }

    ctx.save();
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(state.x, PLAYER_Y, clamp(48 + state.cats * 0.42, 54, 118), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawTinyCat(x, y, scale, fur, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin((angle || 0) + state.time * 2) * 0.08);
    ctx.scale(scale, scale);
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

  function drawParticles() {
    state.particles.forEach((p) => {
      const alpha = clamp(p.ttl / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
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
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.48)";
    roundRect(22, 18, 180, 12, 6);
    ctx.fill();
    ctx.fillStyle = level.bossAccent || C.green;
    roundRect(22, 18, 180 * pct, 12, 6);
    ctx.fill();
    fitText(state.boss ? "BOSS PHASE" : `LEVEL ${levelNumber()} / ${LEVELS.length}`, 112, 50, 170, 15, C.ink, "center");
    ctx.restore();
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

  function pointerToCanvas(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / Math.max(1, rect.width)) * W;
  }

  function setPointerTarget(clientX) {
    state.targetX = clamp(pointerToCanvas(clientX), 88, W - 88);
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
        "Take a pack of extremely ungovernable cats through four levels of household nonsense. Hit the good gates, delete the hazards, and prove that every appliance on earth should mind its business.",
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
