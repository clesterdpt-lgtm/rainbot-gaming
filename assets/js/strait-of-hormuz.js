/* ============================================
   ESCAPE THE STRAIT — continuous dodger
   --------------------------------------------
   v4 — endless-sector refit.
   Real-time floaty steering, 3-hit hull,
   procedural sea assets, Web Audio SFX,
   boss gates every sector, escalating pressure,
   wipeout share card. 100% vanilla canvas.

   Drop-in replacement for the existing
   strait-of-hormuz.html. Uses the existing
   RB API (ads.js).  Public surface additions
   to RB: powerup keys are now an open set;
   the engine treats them as opaque strings.
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // =========================================================================
  // 1. TUNING — the numbers that make the game feel right
  // =========================================================================

  // World space
  const SECTOR_LENGTH = 6200;     // virtual units per endless sector
  const NAUTICAL_MILE_UNITS = 880;
  const VISIBLE_AHEAD = 600;      // how far ahead of the ship we render
  const VISIBLE_BEHIND = Math.ceil((H * 0.5) / 0.7) + 170; // keep objects visible until fully below the camera
  const LANE_HALF_WIDTH = 220;    // total play width is +/- this from centerline

  // Ship — camera-relative controls (see updateShip for the new model).
  // thrust/strafe are ACCELERATIONS (units/sec²). maxSpeed is a velocity cap.
  // Tweak these if the ship feels too sluggish or too twitchy.
  const SHIP_BASE_THRUST    = 180;       // forward acceleration
  const SHIP_BASE_STRAFE    = 0.7;       // strafe is 70% as fast as forward
  const SHIP_BASE_MAX_SPEED = 160;       // top speed in world units/sec
  const SHIP_LINEAR_DAMP    = 0.85;      // 0 = ice, 1 = concrete. Lower = floatier.
  const SHIP_VISUAL_TURN    = 4.0;       // how fast the sprite rotates to match motion
  const SHIP_ANGULAR_DAMP   = 3.5;
  const SHIP_WOBBLE_AMP     = 1.6;       // degrees of roll at idle
  const SHIP_WOBBLE_FREQ    = 1.2;

  // Hull
  const HULL_MAX = 3;
  const IFRAME_DURATION = 1.4;            // seconds of invincibility after a hit
  const HORN_RADIUS = 90;                 // how far the horn pushes mines/subs
  const HORN_COOLDOWN = 0.6;
  const SHIP_COLLISION_HALF_WIDTH = 18;
  const SHIP_COLLISION_HALF_LENGTH = 42;

  // Phases (from the GDD)
  const PHASE_GATES = [0.52, 0.88]; // later, less frequent ad-wall checkpoints per sector
  const BOSS_UNLOCK_SECTOR = 6;
  const HAZARD_UNLOCKS = [
    { sector: 1, type: "mine", label: "mines" },
    { sector: 2, type: "slick", label: "oil slicks" },
    { sector: 3, type: "sub", label: "merchant subs" },
    { sector: 4, type: "rocket", label: "crossing rockets" },
    { sector: 5, type: "drone", label: "customs drones" },
    { sector: BOSS_UNLOCK_SECTOR, type: "container", label: "loose containers and boss walls" },
  ];
  const PHASE_DEFS = [
    { id: 1, name: "OPEN WATER",        width: 220, spawnEvery: 1.70, mix: { mine: 1.00, slick: 0.00, sub: 0.00, rocket: 0.00, drone: 0.00, container: 0.00 }, fog: 0.00 },
    { id: 2, name: "TIGHTEN UP",        width: 196, spawnEvery: 1.42, mix: { mine: 0.78, slick: 0.16, sub: 0.06, rocket: 0.00, drone: 0.00, container: 0.00 }, fog: 0.04 },
    { id: 3, name: "FOG OF HORMUZ",     width: 166, spawnEvery: 1.16, mix: { mine: 0.62, slick: 0.16, sub: 0.15, rocket: 0.07, drone: 0.00, container: 0.00 }, fog: 0.28 },
    { id: 4, name: "NO REFUNDS",        width: 136, spawnEvery: 0.96, mix: { mine: 0.46, slick: 0.10, sub: 0.20, rocket: 0.18, drone: 0.06, container: 0.00 }, fog: 0.40 },
    { id: 5, name: "BOSS WALL",         width: 178, spawnEvery: 1.08, mix: { mine: 0.38, slick: 0.08, sub: 0.14, rocket: 0.18, drone: 0.16, container: 0.06 }, fog: 0.16 },
  ];

  const SECTOR_THEMES = [
    { name: "Neon Gulf", top: "#09546f", mid: "#0a334f", bottom: "#041a2f", foam: "#9ff7ff", coast: "#2d2b3c", glow: "#2ee0ff" },
    { name: "Rustwater", top: "#304c57", mid: "#123746", bottom: "#071a27", foam: "#ffd43b", coast: "#493220", glow: "#ff8c1a" },
    { name: "Pink Alert", top: "#233a68", mid: "#17294a", bottom: "#080d22", foam: "#ffc5df", coast: "#382846", glow: "#ff2e88" },
    { name: "Black Glass", top: "#102c36", mid: "#091d29", bottom: "#030913", foam: "#d7fbff", coast: "#1c2230", glow: "#6bff7d" },
  ];

  // Upgrades (5 funny/strong options)
  const UPGRADES = {
    turbo:        { name: "Turbo Propeller",        icon: "🌀", desc: "+60% speed/thrust for 90s. Held on with zip ties." },
    shield:       { name: "Soap-Bubble Shield",     icon: "🫧", desc: "Absorbs 1 hit. Bubbles float away when popped." },
    radar:        { name: "Rubber Duck Radar",      icon: "🦆", desc: "Highlights threats within 80u for 2 minutes. Quacks." },
    plating:      { name: "Duct Tape Plating",      icon: "🩹", desc: "+1 max hull this run. Squeaks on every turn." },
    fuzzyDice:    { name: "Fuzzy Dice of Fate",     icon: "🎲", desc: "50/50: 8s invincibility OR 2x score. You choose. Fate doesn't." }
  };

  // Wipeout captions
  const WIPEOUT_CAPTIONS = [
    "POV: you tried to outrun a rubber duck's prophecy",
    "I meant to do that. (The duck disagreed.)",
    "Current status: marine biodiversity",
    "Skill issue (this run was 70% luck anyway)",
    "The IOC sends their regards",
    "At least the explosion was on-brand",
    "Duck says: quack. Translation: you died.",
    "Have you considered a career in shore leave?",
    "Imagine if I'd watched that ad. (I didn't.)",
    "This is going on TikTok",
    "The mine face is now your wallpaper.",
    "Insurance claim filed. Deductible: one (1) tanker.",
    "Pro Captains wouldn't have died here. (Probably.)"
  ];

  const DEATH_QUOTES = [
    "Your cargo is now property of the IOC. Try again, Captain.",
    "The ducks have spoken. You have been judged.",
    "Insurance claim filed. Deductible: one (1) tanker."
  ];

  // =========================================================================
  // 2. STATE
  // =========================================================================

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    started: false,

    score: 0,
    distance: 0,             // current z position along the strait
    phase: 1,
    sector: 1,
    threat: 1,
    assetSeed: Math.floor(Math.random() * 999999),

    // Ship (world-space)
    ship: {
      x: 0,                  // lateral
      y: 0,                  // forward (z)
      vx: 0,
      vy: 0,
      heading: 0,            // radians, 0 = +y
      angVel: 0,
      hull: HULL_MAX,
      maxHull: HULL_MAX,
      iframe: 0,
      hornCooldown: 0,
      flashing: 0,           // 0..1 i-frame alpha
      shipScale: 1,
      turboMult: 1,
      plated: false,
    },

    // Input
    input: { throttle: 0, steer: 0, horn: false },

    // World entities
    obstacles: [],           // {type, x, y, vx, vy, w, h, age, life, ...}
    pickups: [],             // oil barrels
    particles: [],
    splashes: [],            // water wake

    // Boss
    boss: null,              // {x, y, w, h, honks, required, resolved, mode}
    bossActive: false,
    bossArmed: false,        // true once the player has been told to honk
    bossSector: 0,
    sectorCleared: 0,
    bossSpawnT: 0,

    // Phase gates
    phaseGatesHit: new Set(),
    inGate: false,

    // Upgrades active
    activeUpgrades: {},      // {kind: expiresAt}
    radarPings: [],          // recent radar detections

    // Camera
    cam: { shake: 0, flash: 0 },
    bannerText: null,
    bannerUntil: 0,

    // Frame buffer for wipeout share (last ~3s)
    ringBuffer: [],
    lastRingPush: 0,

    lastTime: 0,
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create("hormuz", { version: 1 });
  let saveMenu = null;

  const audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    enabled: localStorage.getItem("rb-hormuz-sound") !== "off",
  };

  const ASSET_PATHS = {
    background: "../assets/img/strait/background-neon-strait.png",
    tanker: "../assets/img/strait/tanker.png",
    mine: "../assets/img/strait/mine.png",
    drone: "../assets/img/strait/drone.png",
    container: "../assets/img/strait/container.png",
    slick: "../assets/img/strait/oil-slick.png",
    repairBuoy: "../assets/img/strait/repair-buoy.png",
  };

  const artAssets = {};
  Object.entries(ASSET_PATHS).forEach(([key, src]) => {
    const img = new Image();
    artAssets[key] = { img, ready: false, failed: false };
    img.decoding = "async";
    img.onload = () => {
      artAssets[key].ready = true;
      if (!state.running && typeof draw === "function") requestAnimationFrame(draw);
    };
    img.onerror = () => { artAssets[key].failed = true; };
    img.src = src;
  });

  // =========================================================================
  // 3. UTILITIES
  // =========================================================================

  const rand   = (a, b) => a + Math.random() * (b - a);
  const randi  = (a, b) => Math.floor(rand(a, b));
  const choice = (arr)  => arr[Math.floor(Math.random() * arr.length)];
  const clamp  = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU    = Math.PI * 2;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function getArt(key) {
    const asset = artAssets[key];
    return asset && asset.ready ? asset.img : null;
  }

  function drawArt(key, x, y, w, h, alpha = 1) {
    const img = getArt(key);
    if (!img) return false;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    ctx.restore();
    return true;
  }

  function hash01(n) {
    const x = Math.sin(n * 127.1 + state.assetSeed * 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }

  function pickWeighted(weights) {
    const entries = Object.entries(weights);
    const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0) || 1;
    let roll = Math.random() * total;
    for (const [key, weight] of entries) {
      roll -= Math.max(0, weight);
      if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  function getSectorMetrics(distance = state.distance) {
    const sectorIndex = Math.max(0, Math.floor(distance / SECTOR_LENGTH));
    const sector = sectorIndex + 1;
    const sectorStart = sectorIndex * SECTOR_LENGTH;
    const localDistance = Math.max(0, distance - sectorStart);
    const progress = clamp(localDistance / SECTOR_LENGTH, 0, 0.9999);
    let phase = 1;
    if (progress >= 0.95) phase = 5;
    else if (progress >= 0.80) phase = 4;
    else if (progress >= 0.58) phase = 3;
    else if (progress >= 0.30) phase = 2;
    const sectorRamp = 1 + Math.min(1.6, sectorIndex * 0.10);
    const pressureRamp = 1 + progress * 0.12;
    const threat = sectorRamp * pressureRamp;
    return { sectorIndex, sector, sectorStart, localDistance, progress, phase, threat };
  }

  function getPhaseProgress() {
    return getSectorMetrics();
  }

  function getPhaseDef() {
    return PHASE_DEFS[getPhaseProgress().phase - 1];
  }

  function getLaneHalfWidth() {
    const metrics = getPhaseProgress();
    const def = PHASE_DEFS[metrics.phase - 1];
    const squeeze = Math.min(42, (metrics.sector - 1) * 5);
    return Math.max(86, def.width - squeeze);
  }

  function formatRunDistance(distance = state.distance) {
    return (distance / NAUTICAL_MILE_UNITS).toFixed(1) + " NM";
  }

  function getTheme(sector = getPhaseProgress().sector) {
    return SECTOR_THEMES[(sector - 1) % SECTOR_THEMES.length];
  }

  function getUnlockedHazards(sector = getPhaseProgress().sector) {
    return HAZARD_UNLOCKS
      .filter((hazard) => sector >= hazard.sector)
      .map((hazard) => hazard.type);
  }

  function getHazardMix(metrics = getPhaseProgress()) {
    const unlocked = new Set(getUnlockedHazards(metrics.sector));
    const base = PHASE_DEFS[metrics.phase - 1].mix;
    const mix = {};
    Object.entries(base).forEach(([type, weight]) => {
      if (unlocked.has(type) && weight > 0) mix[type] = weight;
    });
    return Object.keys(mix).length ? mix : { mine: 1 };
  }

  function getNewHazardForSector(sector) {
    return HAZARD_UNLOCKS.find((hazard) => hazard.sector === sector);
  }

  // =========================================================================
  // 4. AUDIO
  // =========================================================================

  function ensureAudio() {
    if (!audio.enabled || audio.ctx) return audio.ctx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audio.ctx = new Ctx();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.22;
      audio.master.connect(audio.ctx.destination);
      startEngineHum();
      updateSoundButton();
      return audio.ctx;
    } catch (err) {
      audio.enabled = false;
      updateSoundButton();
      return null;
    }
  }

  function startEngineHum() {
    const ctxAudio = audio.ctx;
    if (!ctxAudio || audio.engineOsc) return;
    audio.engineOsc = ctxAudio.createOscillator();
    audio.engineGain = ctxAudio.createGain();
    audio.engineOsc.type = "sawtooth";
    audio.engineOsc.frequency.value = 42;
    audio.engineGain.gain.value = 0;
    audio.engineOsc.connect(audio.engineGain);
    audio.engineGain.connect(audio.master);
    audio.engineOsc.start();
  }

  function stopEngineHum() {
    if (!audio.ctx || !audio.engineGain) return;
    audio.engineGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.06);
  }

  function updateEngineHum() {
    if (!audio.ctx || !audio.engineGain || !audio.engineOsc) return;
    const speed = Math.hypot(state.ship.vx, state.ship.vy);
    const active = state.running && !state.paused && !state.gameOver && audio.enabled;
    const targetGain = active ? clamp(0.018 + speed / 9000, 0.018, 0.055) : 0;
    const targetFreq = 38 + clamp(speed, 0, 220) * 0.34 + state.threat * 3;
    audio.engineGain.gain.setTargetAtTime(targetGain, audio.ctx.currentTime, 0.08);
    audio.engineOsc.frequency.setTargetAtTime(targetFreq, audio.ctx.currentTime, 0.08);
  }

  function playTone(freq, dur = 0.12, type = "sine", gain = 0.12, delay = 0) {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !audio.master) return;
    const now = ctxAudio.currentTime + delay;
    const osc = ctxAudio.createOscillator();
    const g = ctxAudio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  function playNoise(dur = 0.18, gain = 0.14, filterFreq = 800) {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !audio.master) return;
    const buffer = ctxAudio.createBuffer(1, Math.floor(ctxAudio.sampleRate * dur), ctxAudio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctxAudio.createBufferSource();
    const filter = ctxAudio.createBiquadFilter();
    const g = ctxAudio.createGain();
    src.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    g.gain.setValueAtTime(gain, ctxAudio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(audio.master);
    src.start();
  }

  function playSfx(kind) {
    if (!audio.enabled) return;
    switch (kind) {
      case "start":
        playTone(196, 0.12, "triangle", 0.08);
        playTone(294, 0.12, "triangle", 0.07, 0.09);
        playTone(392, 0.18, "triangle", 0.06, 0.18);
        break;
      case "honk":
        playTone(180, 0.22, "square", 0.14);
        playTone(142, 0.28, "sawtooth", 0.09, 0.04);
        break;
      case "hit":
        playNoise(0.22, 0.18, 520);
        playTone(74, 0.28, "sawtooth", 0.16);
        break;
      case "boom":
        playNoise(0.5, 0.26, 360);
        playTone(54, 0.55, "sawtooth", 0.22);
        break;
      case "pickup":
        playTone(740, 0.08, "sine", 0.08);
        playTone(980, 0.1, "sine", 0.07, 0.07);
        break;
      case "upgrade":
        playTone(330, 0.08, "triangle", 0.08);
        playTone(495, 0.08, "triangle", 0.08, 0.08);
        playTone(660, 0.12, "triangle", 0.08, 0.16);
        break;
      case "phase":
        playTone(260, 0.08, "square", 0.07);
        playTone(520, 0.14, "square", 0.06, 0.08);
        break;
      case "boss":
        playTone(92, 0.35, "sawtooth", 0.16);
        playTone(138, 0.24, "square", 0.09, 0.16);
        break;
      case "slip":
        playNoise(0.12, 0.08, 1400);
        playTone(220, 0.14, "sine", 0.05);
        break;
    }
  }

  function setSoundEnabled(enabled) {
    audio.enabled = enabled;
    localStorage.setItem("rb-hormuz-sound", enabled ? "on" : "off");
    updateSoundButton();
    if (enabled) {
      ensureAudio();
      if (audio.ctx?.state === "suspended") audio.ctx.resume();
      RB.toast("Sound on", "good");
    } else {
      stopEngineHum();
      RB.toast("Sound muted", "");
    }
  }

  function updateSoundButton() {
    const btn = document.getElementById("btn-sound");
    if (!btn) return;
    btn.textContent = audio.enabled ? "Sound on" : "Muted";
    btn.setAttribute("aria-pressed", audio.enabled ? "true" : "false");
  }

  // =========================================================================
  // 5. INPUT
  // =========================================================================

  const keys = {};
  window.addEventListener("keydown", (e) => {
    const editingText = e.target?.matches?.("input, textarea, select, [contenteditable='true']");
    if (editingText) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (audio.enabled && (e.code === "Space" || e.code.startsWith("Arrow") || e.code.startsWith("Key"))) {
      ensureAudio();
      if (audio.ctx?.state === "suspended") audio.ctx.resume();
    }
    if (e.code === "Space" && state.running && !state.paused && !state.gameOver) {
      tryHonk();
    }
  });
  window.addEventListener("keyup", (e) => {
    const editingText = e.target?.matches?.("input, textarea, select, [contenteditable='true']");
    if (editingText) return;
    keys[e.code] = false;
  });

  function readInput() {
    let throttle = 0, steer = 0;
    if (keys["KeyW"] || keys["ArrowUp"])    throttle += 1;
    if (keys["KeyS"] || keys["ArrowDown"])  throttle -= 1;
    if (keys["KeyA"] || keys["ArrowLeft"])  steer    -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) steer    += 1;
    state.input.throttle = throttle;
    state.input.steer = steer;
  }

  // On-screen controls (mobile / maxed canvas) — replicates held inputs
  function setupTouch() {
    const set = (ctrl, down) => {
      const code = ({
        thrust: "KeyW", brake: "KeyS",
        left:   "KeyA", right:  "KeyD",
        horn:   "Space"
      })[ctrl];
      if (ctrl === "pause" && down) {
        pauseGame();
        return;
      }
      if (ctrl === "sound" && down) {
        setSoundEnabled(!audio.enabled);
        return;
      }
      if (!code) return;
      keys[code] = down;
      if (down && audio.enabled) ensureAudio();
      if (down && ctrl === "horn" && state.running && !state.paused && !state.gameOver) {
        tryHonk();
      }
    };
    document.querySelectorAll("[data-strait-controls] button[data-ctrl]").forEach((btn) => {
      const ctrl = btn.dataset.ctrl;
      const press = (e) => { e.preventDefault(); set(ctrl, true); };
      const release = (e) => { e.preventDefault(); set(ctrl, false); };
      btn.addEventListener("touchstart", press, { passive: false });
      btn.addEventListener("touchend", release, { passive: false });
      btn.addEventListener("touchcancel", release, { passive: false });
      btn.addEventListener("mousedown", press);
      btn.addEventListener("mouseup", release);
      btn.addEventListener("mouseleave", release);
    });
  }

  // =========================================================================
  // 5. SHIP PHYSICS
  // -------------------------------------------------------------------------
  // Camera-relative controls (NOT ship-relative):
  //   W / Up    → +y world (forward, up the strait)
  //   S / Down  → -y world (brake / reverse)
  //   A / Left  → -x world (strafe left)
  //   D / Right → +x world (strafe right)
  // The ship's visual heading still rotates for the floaty look, but it does
  // NOT drive movement. This is the standard arcade-dodger model (think
  // Geometry Wars, Frogger remakes, etc.) — the player presses the direction
  // they want to GO, not the direction they want to FACE.
  // =========================================================================

  function updateShip(dt) {
    if (state.gameOver) return;
    const s = state.ship;

    // i-frame & shield flash
    if (s.iframe > 0) {
      s.iframe -= dt;
      s.flashing = (Math.sin(s.iframe * 30) + 1) * 0.5;
    } else { s.flashing = 0; }
    if (s.hornCooldown > 0) s.hornCooldown -= dt;

    // ---- ACCELERATION (camera-relative) ----
    // Steer is lateral, throttle is forward. Both produce direct velocity changes
    // so the ship responds instantly to input — but with linear damping it still
    // has that "floaty" feel because it takes a moment to accelerate and decelerate.
    const thrust = state.input.throttle * SHIP_BASE_THRUST * s.turboMult;
    const strafe = state.input.steer    * SHIP_BASE_THRUST * s.turboMult * SHIP_BASE_STRAFE;

    // y is "up the strait" — worldToScreen maps +y to -screen-y (forward = up on screen)
    // x is lateral. Positive x = right on screen, negative x = left.
    s.vy += thrust * dt;
    s.vx += strafe * dt;

    // ---- VISUAL HEADING (cosmetic float — does not affect movement) ----
    // Drift the visual heading toward the actual movement direction so the
    // ship appears to "turn into" the turn, but with a delay for comedy.
    let targetHeading = 0;
    if (Math.hypot(s.vx, s.vy) > 8) {
      targetHeading = Math.atan2(s.vx, s.vy); // 0 when moving +y, positive when moving right
    }
    // Smooth visual rotation toward target
    let dh = targetHeading - s.heading;
    // Wrap to shortest path
    while (dh >  Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    s.heading += dh * Math.min(1, dt * SHIP_VISUAL_TURN);

    // ---- LINEAR DAMPING (the "floaty" feel) ----
    // 0 = no damping (ice), 1 = full damping (concrete). 0.85 feels arcade-floaty.
    s.vx *= Math.max(0, 1 - SHIP_LINEAR_DAMP * dt);
    s.vy *= Math.max(0, 1 - SHIP_LINEAR_DAMP * dt);

    // ---- CAP SPEED ----
    const maxSpd = SHIP_BASE_MAX_SPEED * s.turboMult;
    const spd = Math.hypot(s.vx, s.vy);
    if (spd > maxSpd) {
      s.vx = (s.vx / spd) * maxSpd;
      s.vy = (s.vy / spd) * maxSpd;
    }

    // ---- MOVE ----
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // ---- CLAMP TO CURRENT LANE ----
    const laneHalf = getLaneHalfWidth();
    if (s.x < -laneHalf) { s.x = -laneHalf; s.vx = 0; }
    if (s.x >  laneHalf) { s.x =  laneHalf; s.vx = 0; }
    // Don't let the player go backward past start
    if (s.y < 0) { s.y = 0; s.vy = Math.max(0, s.vy); }

    // ---- WAKE SPLASHES ----
    if (spd > 30 && Math.random() < 0.4) {
      state.splashes.push({
        x: s.x,
        y: s.y - 18,  // behind the ship (slightly back from y)
        life: 0.8, age: 0
      });
    }

    // ---- DISTANCE ----
    state.distance = Math.max(state.distance, s.y);
  }

  // =========================================================================
  // 6. HORN
  // =========================================================================

  function tryHonk() {
    ensureAudio();
    const s = state.ship;
    if (s.hornCooldown > 0) return;
    s.hornCooldown = HORN_COOLDOWN;
    playSfx("honk");

    // Boss interaction
    if (state.bossActive && state.boss && !state.boss.resolved) {
      const dx = s.x - state.boss.x;
      const dy = s.y - state.boss.y;
      if (Math.hypot(dx, dy) < 260) {
        state.boss.honks++;
        const el = document.getElementById("honk-count");
        if (el) el.textContent = `${state.boss.honks}/${state.boss.required}`;
        spawnParticles(state.boss.x, state.boss.y - 10, "#f7d716", 20, 220);
        state.cam.shake = Math.max(state.cam.shake, 0.12);
        if (state.boss.honks >= state.boss.required) {
          resolveBoss(true);
        }
      }
      return;
    }

    // Repel obstacles
    let cleared = 0;
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      const d = Math.hypot(s.x - o.x, s.y - o.y);
      if (d < HORN_RADIUS) {
        if (o.type === "mine") { o.dead = true; cleared++; spawnParticles(o.x, o.y, "#ff5c5c", 16, 180); }
        else if (o.type === "sub") { o.retreat = true; cleared++; spawnParticles(o.x, o.y, "#2ee0ff", 14, 160); }
        else if (o.type === "rocket") { o.dead = true; cleared++; spawnParticles(o.x, o.y, "#ff8c1a", 18, 200); }
        else if (o.type === "drone") { o.dead = true; cleared++; spawnParticles(o.x, o.y, "#2ee0ff", 18, 220); }
        else if (o.type === "slick") { o.dead = true; cleared++; spawnParticles(o.x, o.y, "#b7ffef", 10, 120); }
        else if (o.type === "container") { o.vx += (o.x < s.x ? -80 : 80); cleared++; spawnParticles(o.x, o.y, "#ffd43b", 12, 150); }
      }
    }
    if (cleared > 0) RB.toast(`📯 HORN! cleared ${cleared} hazard${cleared === 1 ? "" : "s"}`, "good");
  }

  // =========================================================================
  // 7. OBSTACLES
  // =========================================================================

  function spawnObstacle(typeOverride = null) {
    const metrics = getPhaseProgress();
    const type = typeOverride || pickWeighted(getHazardMix(metrics));
    const difficulty = Math.min(1.9, metrics.threat);
    const laneHalf = getLaneHalfWidth();

    const s = state.ship;
    const aheadY = s.y + VISIBLE_AHEAD + rand(0, 60);
    const lateral = rand(-laneHalf + 14, laneHalf - 14);
    const o = {
      type,
      x: lateral,
      y: aheadY,
      age: 0,
      life: 18,
      seed: Math.floor(Math.random() * 99999),
      tint: getTheme(metrics.sector).glow
    };

    if (type === "mine") {
      o.vx = rand(-7, 7) * difficulty;
      o.vy = -rand(38, 56) * difficulty;     // approach speed (world units/sec) toward player
      o.phase_offset = Math.random() * TAU;
      o.bob_amp = rand(1.2, 2.5);
      o.face = choice(["smug", "surprised", "offended"]);
      o.spikes = randi(7, 11);
      o.w = 22 + Math.min(7, metrics.sector); o.h = o.w;
    } else if (type === "sub") {
      o.dir = Math.random() < 0.5 ? 1 : -1;
      o.vx = o.dir * rand(38, 64) * difficulty;
      o.vy = -rand(28, 52) * difficulty;     // sub approaches the player, not just sits still
      o.tell = rand(0.45, 1.05);  // telegraph duration
      o.dove = false;
      o.w = 50; o.h = 22;
    } else if (type === "rocket") {
      const side = Math.random() < 0.5 ? -1 : 1;
      const rocketSpeed = rand(250, 360) * Math.min(1.45, 0.95 + difficulty * 0.22);
      o.x = side * (laneHalf + rand(70, 130));
      o.y = state.ship.y + rand(-70, VISIBLE_AHEAD * 0.78);
      o.vx = -side * rocketSpeed;
      o.vy = -rand(12, 34) * Math.min(1.25, difficulty);
      o.w = 14; o.h = 44;
      o.life = 3.4;
    } else if (type === "drone") {
      o.dir = Math.random() < 0.5 ? 1 : -1;
      o.vx = o.dir * rand(80, 126) * difficulty;
      o.vy = -rand(22, 44) * difficulty;
      o.w = 28; o.h = 18;
      o.blink = Math.random() * TAU;
    } else if (type === "slick") {
      o.vx = rand(-10, 10);
      o.vy = -rand(20, 40) * difficulty;
      o.w = rand(42, 68);
      o.h = rand(20, 34);
      o.spin = rand(-1.4, 1.4);
      o.slipped = false;
    } else if (type === "container") {
      o.vx = rand(-22, 22) * difficulty;
      o.vy = -rand(36, 62) * difficulty;
      o.w = rand(34, 54);
      o.h = rand(22, 30);
      o.color = choice(["#ff5c5c", "#2ee0ff", "#ffd43b", "#ff8c1a"]);
    }

    state.obstacles.push(o);
  }

  function updateObstacles(dt) {
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.age += dt;

      if (o.type === "mine") {
        o.x += o.vx * dt;
        o.y += o.vy * dt + Math.sin((o.age + o.phase_offset) * 1.8) * o.bob_amp * dt * 4;
      } else if (o.type === "sub") {
        o.tell -= dt;
        if (o.tell <= 0 && !o.dove) o.dove = true;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        // Mid-life switch direction (the "tariff" two-step)
        if (o.age > 2.0 && !o.switched) {
          o.vx = -o.vx;
          o.switched = true;
        }
        if (o.retreat) o.vy += 80 * dt; // dive away
      } else if (o.type === "rocket") {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
      } else if (o.type === "drone") {
        o.x += o.vx * dt;
        o.y += o.vy * dt + Math.sin(o.age * 8 + o.blink) * 10 * dt;
        const lane = getLaneHalfWidth();
        if (Math.abs(o.x) > lane + 40) o.vx *= -1;
      if (o.age > 0.9 && !o.dropped && Math.abs(o.x - state.ship.x) < 34) {
        o.dropped = true;
        spawnObstacle("mine");
        const mine = state.obstacles[state.obstacles.length - 1];
        mine.x = o.x;
        mine.y = o.y + 18;
        mine.vy = -72 * Math.min(1.8, state.threat);
      }
      } else if (o.type === "slick") {
        o.x += o.vx * dt + Math.sin(o.age * 2 + o.seed) * 4 * dt;
        o.y += o.vy * dt;
      } else if (o.type === "container") {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        o.vx += Math.sin(o.age * 1.7 + o.seed) * 8 * dt;
      }

      // Despawn behind ship
      if (o.y < state.ship.y - VISIBLE_BEHIND) o.dead = true;
      if (o.y > state.ship.y + VISIBLE_AHEAD * 1.5) o.dead = true;
      const offscreenX = W * 0.5 + Math.max(o.w || 0, o.h || 0) + 80;
      if (o.x < -offscreenX || o.x > offscreenX) o.dead = true;
      if (o.age > o.life) o.dead = true;

      if (o.dead) {
        if (o.type === "mine" && !o.silentKill && Math.random() < 0.4) {
          // Mine quip when destroyed by horn/age
          // (we keep it silent on passive despawn to avoid noise)
        }
        state.obstacles.splice(i, 1);
        continue;
      }

      // Collision with ship
      if (!state.ship.iframe && collideShipObstacle(o)) {
        handleObstacleContact(o);
      }
    }
  }

  function handleObstacleContact(o) {
    if (o.type === "slick") {
      if (o.slipped) return;
      o.slipped = true;
      o.dead = true;
      state.ship.vx += (state.ship.x < o.x ? -1 : 1) * 92 * state.threat;
      state.ship.vy *= 0.55;
      state.cam.shake = Math.max(state.cam.shake, 0.18);
      spawnParticles(o.x, o.y, "#b7ffef", 12, 160);
      playSfx("slip");
      takeHit(o);
      return;
    }
    takeHit(o);
  }

  function collideShipObstacle(o) {
    const s = state.ship;
    const dx = s.x - o.x, dy = s.y - o.y;
    if (o.type === "slick") {
      const nx = dx / Math.max(18, SHIP_COLLISION_HALF_WIDTH + o.w * 0.82);
      const ny = dy / Math.max(12, SHIP_COLLISION_HALF_LENGTH + o.h * 0.92);
      return (nx * nx + ny * ny) < 1.15;
    }
    if (o.type === "drone") {
      return Math.abs(dx) < SHIP_COLLISION_HALF_WIDTH + 30
        && Math.abs(dy) < SHIP_COLLISION_HALF_LENGTH + 24;
    }
    if (o.type === "container") {
      return Math.abs(dx) < SHIP_COLLISION_HALF_WIDTH + o.w * 0.92
        && Math.abs(dy) < SHIP_COLLISION_HALF_LENGTH + o.h * 1.05;
    }
    const rObs = Math.max(o.w, o.h) * 0.5;
    const scale = o.type === "rocket" ? 1.15 : o.type === "mine" ? 1.05 : 0.95;
    const nx = dx / (SHIP_COLLISION_HALF_WIDTH + rObs * scale);
    const ny = dy / (SHIP_COLLISION_HALF_LENGTH + rObs * scale);
    return (nx * nx + ny * ny) < 1;
  }

  function resolveDamagingContact(source) {
    if (!source || !source.type || source.type === "boss") return;
    if (source.type === "sub") {
      source.retreat = true;
      source.vy = Math.min(source.vy || 0, -90);
      return;
    }
    source.dead = true;
  }

  // =========================================================================
  // 8. HULL DAMAGE
  // =========================================================================

  function takeHit(source) {
    const s = state.ship;
    resolveDamagingContact(source);
    // Shield check first
    if (hasShield()) {
      consumeShield();
      s.iframe = IFRAME_DURATION;
      return;
    }
    applyScorePenalty(Math.round(220 + state.threat * 80), "HULL HIT");
    s.hull = Math.max(0, s.hull - 1);
    s.iframe = IFRAME_DURATION;
    state.cam.shake = 0.5;
    state.cam.flash = 0.4;
    spawnParticles(s.x, s.y, "#ff5c5c", 24, 240);
    spawnParticles(s.x, s.y, "#ff8c1a", 16, 200);
    playSfx(s.hull <= 0 ? "boom" : "hit");

    let reason = source?.type === "mine" ? "Sentient Mine"
              : source?.type === "sub"  ? "Angry Merchant Sub"
              : source?.type === "rocket" ? "Crossfire Rocket"
              : source?.type === "drone" ? "Customs Drone with Boundary Issues"
              : source?.type === "slick" ? "Oil Slick with Legal Immunity"
              : source?.type === "container" ? "Loose Container of Bad Ideas"
              : source?.type === "boss" ? "Container Ship With Main Character Energy"
              : "Mystery Explosion";
    state.lastCauseOfDeath = reason;

    if (s.hull <= 0) {
      wipeout();
    } else {
      const msg = source?.type === "mine" ? "💥 Mine hit — " + s.hull + " hull left"
                : source?.type === "sub"  ? "💥 Sub clipped — " + s.hull + " hull left"
                : source?.type === "rocket" ? "💥 Rocket hit — " + s.hull + " hull left"
                : source?.type === "drone" ? "💥 Drone bonk — " + s.hull + " hull left"
                : source?.type === "slick" ? "💥 Oil slick crash — " + s.hull + " hull left"
                : source?.type === "container" ? "💥 Container crunch — " + s.hull + " hull left"
                : "💥 Hull hit — " + s.hull + " hull left";
      RB.toast(msg, "bad");
      updateHUD();
    }
  }

  function applyScorePenalty(amount, label) {
    const penalty = Math.min(state.score, Math.max(0, Math.round(amount)));
    if (!penalty) return;
    state.score -= penalty;
    RB.toast(`-${penalty.toLocaleString()} ${label}`, "bad");
    updateHUD();
  }

  function wipeout() {
    if (state.gameOver) return;
    state.gameOver = true;
    if (saveSlot) saveSlot.clear();
    state._dethTime = performance.now();
    state.lastDeathScore = state.score;
    state.lastDeathDistance = formatRunDistance(state.distance);
    state.lastDeathSector = getPhaseProgress().sector;
    stopEngineHum();

    // Big explosion
    spawnParticles(state.ship.x, state.ship.y, "#ff5c5c", 60, 320);
    spawnParticles(state.ship.x, state.ship.y, "#ff8c1a", 40, 280);
    spawnParticles(state.ship.x, state.ship.y, "#f7d716", 30, 220);
    state.cam.shake = 0.9;
    state.cam.flash = 0.9;

    // Sad trombone hook (mock)
    setTimeout(() => RB.toast("💀 " + choice(DEATH_QUOTES), "bad"), 600);

    // Record score
    const isHigh = RB.recordScore("hormuz", state.score);
    if (isHigh) RB.toast("🏆 NEW HIGH SCORE!", "good");

    // Show wipeout card after a short delay so the player sees the boom
    setTimeout(showWipeout, 1100);
  }

  // =========================================================================
  // 9. PICKUPS (oil barrels)
  // =========================================================================

  function maybeSpawnPickup() {
    const metrics = getPhaseProgress();
    const pickupChance = clamp(0.018 - (metrics.sector - 1) * 0.0015, 0.008, 0.018);
    if (Math.random() > pickupChance) return; // rare-ish
    const s = state.ship;
    const laneHalf = getLaneHalfWidth();
    const type = Math.random() < 0.18 && s.hull < s.maxHull ? "patch" : "oil";
    state.pickups.push({
      type,
      x: rand(-laneHalf + 22, laneHalf - 22),
      y: s.y + rand(80, VISIBLE_AHEAD),
      age: 0
    });
  }

  function updatePickups(dt) {
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const p = state.pickups[i];
      p.age += dt;
      if (p.y < state.ship.y - VISIBLE_BEHIND) { state.pickups.splice(i, 1); continue; }
      if (dist2(p.x, p.y, state.ship.x, state.ship.y) < 22 * 22) {
        state.pickups.splice(i, 1);
        if (p.type === "patch") {
          state.ship.hull = Math.min(state.ship.maxHull, state.ship.hull + 1);
          state.score += 120;
          spawnParticles(p.x, p.y, "#6bff7d", 16, 180);
          RB.toast("+1 HULL PATCH", "good");
        } else {
          state.score += 50;
          spawnParticles(p.x, p.y, "#f7d716", 14, 200);
          spawnParticles(p.x, p.y, "#ff8c1a", 8, 140);
          RB.toast("+50 OIL", "good");
        }
        playSfx("pickup");
        updateHUD();
      }
    }
  }

  // =========================================================================
  // 10. PARTICLES + SPLASHES
  // =========================================================================

  function spawnParticles(x, y, color, count = 12, speed = 200) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.5 + Math.random() * 0.7);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        life: 0.5 + Math.random() * 0.5,
        age: 0, color, size: 2 + Math.random() * 3
      });
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.age += dt;
      if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 200 * dt;
    }
    for (let i = state.splashes.length - 1; i >= 0; i--) {
      const s = state.splashes[i];
      s.age += dt;
      if (s.age >= s.life) state.splashes.splice(i, 1);
    }
  }

  // =========================================================================
  // 11. BOSS
  // =========================================================================

  function armBoss() {
    const metrics = getPhaseProgress();
    if (state.bossSector === metrics.sector || state.sectorCleared === metrics.sector) return;
    state.bossArmed = true;
    state.bossActive = true;
    state.bossSector = metrics.sector;
    state.bossSpawnT = 0;
    state.boss = {
      x: 0,
      y: metrics.sectorStart + SECTOR_LENGTH - 210,
      w: Math.max(420, 560 - (metrics.sector - 1) * 12),
      h: 80,
      honks: 0,
      required: Math.min(9, 4 + metrics.sector),
      resolved: false,
      mode: "idle",
      sector: metrics.sector,
      wobble: Math.random() * TAU
    };
    state.bannerText = `🚢 SECTOR ${metrics.sector} BOSS — HONK ${state.boss.required} TIMES!`;
    state.bannerUntil = performance.now() + 2400;
    playSfx("boss");
    const hud = document.getElementById("boss-honkhud");
    if (hud) hud.style.display = "block";
    const el = document.getElementById("honk-count");
    if (el) el.textContent = `0/${state.boss.required}`;
  }

  function updateBoss(dt) {
    const b = state.boss;
    if (!b || !state.bossActive) return;
    b.age = (b.age || 0) + dt;
    b.x = Math.sin(b.age * 0.75 + b.wobble) * Math.min(52, 16 + b.sector * 5);
    b.y -= Math.min(18 + b.sector * 2, 42) * dt;

    if (!b.resolved) {
      state.bossSpawnT += dt;
      const spawnCadence = Math.max(0.55, 1.35 - b.sector * 0.08);
      if (state.bossSpawnT >= spawnCadence) {
        state.bossSpawnT = 0;
        spawnObstacle(Math.random() < 0.55 ? "container" : "drone");
        const latest = state.obstacles[state.obstacles.length - 1];
        latest.x = clamp(b.x + rand(-b.w * 0.42, b.w * 0.42), -getLaneHalfWidth() + 20, getLaneHalfWidth() - 20);
        latest.y = b.y + rand(40, 90);
      }

      if (state.ship.y > b.y - 88) {
        state.ship.y = b.y - 88;
        state.ship.vy = Math.min(state.ship.vy, -80);
        if (!state.ship.iframe) takeHit({ type: "boss" });
      }
    } else if (b.age > (b.resolvedAt || 0) + 1.2) {
      state.bossActive = false;
      state.boss = null;
    }
  }

  function resolveBoss(success) {
    const b = state.boss;
    if (!b || b.resolved) return;
    b.resolved = true;
    b.resolvedAt = b.age || 0;
    b.mode = success ? "success" : "fail";
    if (success) {
      const bonus = 4200 + b.sector * 900;
      state.score += bonus;
      state.sectorCleared = b.sector;
      RB.toast(`🚢 +${bonus.toLocaleString()} SECTOR ${b.sector} CLEARED!`, "good");
      spawnParticles(b.x, b.y - 20, "#6bff7d", 40, 280);
      spawnParticles(b.x, b.y - 20, "#2ee0ff", 30, 220);
      playSfx("upgrade");
    } else {
      RB.toast("🚢 ignored. The ship passed on its own.", "");
    }
    setTimeout(() => {
      const hud = document.getElementById("boss-honkhud");
      if (hud) hud.style.display = "none";
    }, 800);
  }

  // =========================================================================
  // 12. PHASE GATES (ad-wall)
  // =========================================================================

  function checkPhaseGates() {
    const { progress, sector } = getPhaseProgress();
    for (let i = 0; i < PHASE_GATES.length; i++) {
      const gateKey = `${sector}:${i}`;
      if (progress >= PHASE_GATES[i] && !state.phaseGatesHit.has(gateKey)) {
        state.phaseGatesHit.add(gateKey);
        openGate(i);
        return;
      }
    }
  }

  function openGate(gateIndex) {
    state.inGate = true;
    state.paused = true;
    // Pick 3 random upgrades
    const keys = Object.keys(UPGRADES);
    const offered = [];
    while (offered.length < Math.min(3, keys.length)) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      if (!offered.includes(k)) offered.push(k);
    }
    renderGate(gateIndex, offered);
  }

  function closeGate() {
    state.inGate = false;
    state.paused = false;
    const mount = document.getElementById("gate-mount");
    if (mount) mount.innerHTML = "";
  }

  // =========================================================================
  // 13. UPGRADE APPLICATION
  // =========================================================================

  function applyUpgrade(kind) {
    const s = state.ship;
    const now = performance.now() / 1000;
    switch (kind) {
      case "turbo":
        s.turboMult = 1.6;
        state.activeUpgrades.turbo = now + 90;
        break;
      case "shield":
        state.activeUpgrades.shield = now + 9999;  // consumed on hit
        break;
      case "radar":
        state.activeUpgrades.radar = now + 120;
        break;
      case "plating":
        if (!s.plated) {
          s.plated = true;
          s.maxHull = HULL_MAX + 1;
          s.hull = Math.min(s.hull + 1, s.maxHull);
        }
        state.activeUpgrades.plating = now + 9999; // permanent this run
        break;
      case "fuzzyDice": {
        const goInv = Math.random() < 0.5;
        if (goInv) {
          s.iframe = Math.max(s.iframe, 8);
          state.activeUpgrades.fuzzyDice = now + 8;
        } else {
          state.activeUpgrades.fuzzyDice = now + 10;
        }
        break;
      }
    }
    updateHUD();
    renderPowerups();
    playSfx("upgrade");
  }

  function tickUpgrades() {
    const s = state.ship;
    const now = performance.now() / 1000;
    // Turbo expiry
    if (state.activeUpgrades.turbo && now > state.activeUpgrades.turbo) {
      s.turboMult = 1;
      delete state.activeUpgrades.turbo;
      RB.toast("⏰ Turbo expired", "");
      renderPowerups();
    }
    // Radar expiry
    if (state.activeUpgrades.radar && now > state.activeUpgrades.radar) {
      delete state.activeUpgrades.radar;
      RB.toast("🦆 Duck radar offline", "");
      renderPowerups();
    }
    if (state.activeUpgrades.fuzzyDice && now > state.activeUpgrades.fuzzyDice) {
      delete state.activeUpgrades.fuzzyDice;
      RB.toast("🎲 Dice stopped judging", "");
      renderPowerups();
    }
    if (!state._nextPowerupRender || now >= state._nextPowerupRender) {
      state._nextPowerupRender = now + 1;
      renderPowerups();
    }
  }

  function hasShield() {
    return state.activeUpgrades.shield != null;
  }
  function consumeShield() {
    delete state.activeUpgrades.shield;
    state.cam.shake = 0.3;
    state.cam.flash = 0.2;
    spawnParticles(state.ship.x, state.ship.y, "#2ee0ff", 18, 180);
    RB.toast("🫧 Soap-bubble popped! (Shield gone)", "");
    renderPowerups();
  }

  // (shield check is now done inside takeHit itself)

  // =========================================================================
  // 14. WIPEOUT SHARE CARD
  // =========================================================================

  function showWipeout() {
    const mount = document.getElementById("wipeout-mount");
    if (!mount) return;
    const caption = choice(WIPEOUT_CAPTIONS);
    const cause = state.lastCauseOfDeath || "Mystery Explosion";
    const runDistance = state.lastDeathDistance || formatRunDistance(state.distance);
    const sector = state.lastDeathSector || getPhaseProgress().sector;
    const isHigh = RB.getHighScore("hormuz") === state.score;
    mount.innerHTML = `
      <div class="wipeout-card">
        <div class="wipeout-card__death">💀 ${escapeHtml(cause)}</div>
        <div class="wipeout-card__stats">
          Score: <strong>${state.score.toLocaleString()}</strong> ·
          Run: <strong>${runDistance}</strong> · Sector: <strong>${sector}</strong> · Phase: <strong>${state.phase}</strong>
          ${isHigh ? '<br/><span style="color:var(--good)">🏆 NEW HIGH SCORE</span>' : ""}
        </div>
        <div class="wipeout-card__caption">"${escapeHtml(caption)}"</div>
        <div class="wipeout-card__actions">
          <button class="btn btn--primary" id="wipeout-share">📤 Share Wipeout</button>
          <button class="btn btn--secondary" id="wipeout-retry">⛴ Retry</button>
          <button class="btn btn--ghost" id="wipeout-home" style="font-size:13px;padding:10px 14px;">All Games</button>
        </div>
        <div style="margin-top:14px;font-size:11px;color:var(--ink-dim);">
          ${RB.isAdFree() ? "Pro: ads removed" : "Pro Captain removes ads everywhere → $3.99/mo"}
        </div>
      </div>
    `;
    document.getElementById("wipeout-share").addEventListener("click", shareWipeout);
    document.getElementById("wipeout-retry").addEventListener("click", () => { mount.innerHTML = ""; startGame(); });
    document.getElementById("wipeout-home").addEventListener("click", () => { window.location.href = "../games.html"; });
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  function shareWipeout() {
    // Use the most recent frame in the ring buffer if we have one
    const recent = state.ringBuffer[state.ringBuffer.length - 1];
    const caption = `I just died in Escape the Straight 🚢💥 Score: ${state.score.toLocaleString()} · ${formatRunDistance(state.distance)} · Sector ${getPhaseProgress().sector} #EscapeTheStraight`;
    if (recent && navigator.canShare && navigator.share) {
      recent.canvas.toBlob((blob) => {
        if (!blob) return fallbackCopy(caption);
        const file = new File([blob], "wipeout.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "Escape the Straight", text: caption })
            .then(() => RB.toast("📤 Shared!", "good"))
            .catch(() => fallbackCopy(caption));
        } else {
          fallbackCopy(caption);
        }
      }, "image/png");
    } else {
      fallbackCopy(caption);
    }
  }

  function fallbackCopy(caption) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(caption).then(() => RB.toast("📋 Caption copied to clipboard", "good"));
    } else {
      RB.toast("📤 Share not available on this device", "");
    }
  }

  // =========================================================================
  // 15. GATE UI (ad-wall upgrade picker)
  // =========================================================================

  function renderGate(gateIndex, offered) {
    const mount = document.getElementById("gate-mount");
    if (!mount) return;
    const labels = ["MID", "FINAL"];
    const label = labels[gateIndex] || "EXTRA";
    const sector = getPhaseProgress().sector;
    mount.innerHTML = `
      <div class="gate-card">
        <div class="gate-card__title">⚡ SECTOR ${sector} · ${label} AD WALL</div>
        <div class="gate-card__sub">You made it to the ${label} checkpoint. Pick an upgrade before the Strait gets louder.</div>
        <div class="gate-card__grid" id="gate-options">
          ${offered.map((k) => `
            <button class="gate-card__option" data-kind="${k}">
              <span class="gate-card__option-icon">${UPGRADES[k].icon}</span>
              <p class="gate-card__option-name">${UPGRADES[k].name}</p>
              <p class="gate-card__option-desc">${UPGRADES[k].desc}</p>
            </button>
          `).join("")}
        </div>
        <div class="gate-card__ad-hint">Tap an upgrade to watch the ad and claim it. Skip at your peril.</div>
        <button class="gate-card__skip" id="gate-skip">Skip — I'm too tough for ads</button>
      </div>
    `;
    mount.querySelectorAll(".gate-card__option").forEach((btn) => {
      btn.addEventListener("click", () => requestUpgrade(btn.dataset.kind));
    });
    document.getElementById("gate-skip").addEventListener("click", () => {
      RB.toast("Skipped. The duck judges silently.", "bad");
      closeGate();
    });
  }

  function requestUpgrade(kind) {
    if (RB.isAdFree()) {
      // Pro users skip the ad
      applyUpgrade(kind);
      RB.toast(`✨ ${UPGRADES[kind].name} applied (Pro)`, "good");
      closeGate();
      return;
    }
    RB.showRewarded().then((finished) => {
      if (finished) {
        applyUpgrade(kind);
        RB.toast(`✨ ${UPGRADES[kind].name} claimed!`, "good");
      } else {
        RB.toast("Ad not completed — no reward", "bad");
      }
      closeGate();
    });
  }

  // =========================================================================
  // 16. RENDERING
  // =========================================================================

  function worldToScreen(wx, wy) {
    // Ship always at vertical center; horizontal also centered
    return {
      x: W / 2 + wx,
      y: H / 2 - (wy - state.ship.y) * 0.7   // slight perspective: forward moves up
    };
  }

  function drawGeneratedWorld(metrics, phaseDef) {
    const theme = getTheme(metrics.sector);
    const bg = getArt("background");
    if (bg) {
      ctx.drawImage(bg, 0, 0, W, H);
      ctx.fillStyle = `rgba(3, 9, 18, ${Math.min(0.20, (metrics.sector - 1) * 0.025)})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      const water = ctx.createLinearGradient(0, 0, 0, H);
      water.addColorStop(0, theme.top);
      water.addColorStop(0.45, theme.mid);
      water.addColorStop(1, theme.bottom);
      ctx.fillStyle = water;
      ctx.fillRect(0, 0, W, H);
      drawCoastSilhouettes(metrics, theme);
    }

    drawCurrentBands(metrics, theme);
    drawGeneratedProps(metrics, theme);
    drawSectorMarkers(metrics, theme);

    if (phaseDef.fog > 0) {
      const fog = ctx.createLinearGradient(0, 0, W, H);
      fog.addColorStop(0, `rgba(190, 220, 230, ${phaseDef.fog * 0.18})`);
      fog.addColorStop(0.5, `rgba(255, 255, 255, ${phaseDef.fog * 0.08})`);
      fog.addColorStop(1, `rgba(180, 200, 220, ${phaseDef.fog * 0.22})`);
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawCurrentBands(metrics, theme) {
    const baseCell = Math.floor((state.ship.y - VISIBLE_BEHIND) / 44);
    for (let i = 0; i < 25; i++) {
      const cell = baseCell + i;
      const wy = cell * 44;
      const p = worldToScreen(0, wy);
      if (p.y < -60 || p.y > H + 60) continue;
      const drift = (hash01(cell + metrics.sector * 17) - 0.5) * 120;
      const width = 80 + hash01(cell * 3.7) * 210;
      const alpha = 0.06 + hash01(cell * 9.1) * 0.10;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1 + hash01(cell * 5.3) * 2.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - width + drift, p.y);
      ctx.quadraticCurveTo(W / 2 + drift * 0.2, p.y + 14, W / 2 + width + drift, p.y + 2);
      ctx.stroke();
      if (i % 4 === 0) {
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.6})`;
        ctx.fillRect(W / 2 + drift * 0.5, p.y + 12, 18 + hash01(cell * 11) * 42, 1);
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.0016 + metrics.sector);
    ctx.strokeStyle = `rgba(46,224,255,${0.06 + pulse * 0.05})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 18]);
    for (let x = -120; x <= 120; x += 120) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + x, 0);
      ctx.bezierCurveTo(W / 2 + x + 30, H * 0.25, W / 2 + x - 28, H * 0.65, W / 2 + x + 18, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawCoastSilhouettes(metrics, theme) {
    const laneHalf = getLaneHalfWidth();
    const leftEdge = worldToScreen(-laneHalf, 0).x;
    const rightEdge = worldToScreen(laneHalf, 0).x;
    ctx.fillStyle = theme.coast;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let y = 0; y <= H + 40; y += 40) {
      const wy = state.ship.y + (H / 2 - y) / 0.7;
      const n = hash01(Math.floor(wy / 120) + metrics.sector * 19);
      ctx.lineTo(leftEdge - 36 - n * 52, y);
    }
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(W, 0);
    for (let y = 0; y <= H + 40; y += 40) {
      const wy = state.ship.y + (H / 2 - y) / 0.7;
      const n = hash01(Math.floor(wy / 120) + metrics.sector * 31);
      ctx.lineTo(rightEdge + 36 + n * 52, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftEdge, 0); ctx.lineTo(leftEdge, H);
    ctx.moveTo(rightEdge, 0); ctx.lineTo(rightEdge, H);
    ctx.stroke();
  }

  function drawGeneratedProps(metrics, theme) {
    const laneHalf = getLaneHalfWidth();
    const baseCell = Math.floor((state.ship.y - VISIBLE_BEHIND) / 170);
    for (let i = 0; i < 9; i++) {
      const cell = baseCell + i;
      const wy = cell * 170 + hash01(cell * 2.13) * 90;
      const side = hash01(cell * 5.91 + metrics.sector) < 0.5 ? -1 : 1;
      const wx = side * (laneHalf + 28 + hash01(cell * 7.77) * 70);
      const p = worldToScreen(wx, wy);
      if (p.y < -80 || p.y > H + 80) continue;
      const kindRoll = hash01(cell * 11.17 + metrics.sector * 23);
      if (kindRoll < 0.58) drawGeneratedWreckage(p.x, p.y, theme, cell);
      else if (kindRoll < 0.78) drawGeneratedRig(p.x, p.y, theme, side);
    }
  }

  function drawGeneratedWreckage(x, y, theme, seed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((hash01(seed) - 0.5) * 0.7);
    ctx.fillStyle = "rgba(8,8,16,0.62)";
    roundRect(ctx, -22, -6, 44, 12, 3);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + hash01(seed * 3) * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(-16, -1); ctx.lineTo(16, 2);
    ctx.moveTo(-4, -8); ctx.lineTo(8, 8);
    ctx.stroke();
    ctx.fillStyle = theme.glow;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(-18, 8, 36, 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawGeneratedRig(x, y, theme, side) {
    ctx.save();
    ctx.translate(x + side * 12, y - 16);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-16, 32); ctx.lineTo(0, -18); ctx.lineTo(16, 32);
    ctx.moveTo(-12, 8); ctx.lineTo(12, 8);
    ctx.moveTo(-8, 20); ctx.lineTo(8, 20);
    ctx.stroke();
    ctx.fillStyle = theme.glow;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(-4, -24, 8, 8);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawSectorMarkers(metrics, theme) {
    const marks = [1];
    for (const mark of marks) {
      const wy = metrics.sectorStart + SECTOR_LENGTH * mark;
      const p = worldToScreen(0, wy);
      if (p.y < -20 || p.y > H + 20) continue;
      ctx.strokeStyle = `rgba(255,46,136,0.45)`;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(24, p.y);
      ctx.lineTo(W - 24, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff2e88";
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.textAlign = "right";
      const label = "BOSS WATER";
      ctx.fillText(label, W - 30, p.y - 6);
    }
  }

  function draw() {
    // Camera shake
    const shake = state.cam.shake;
    const sx = (Math.random() - 0.5) * shake * 12;
    const sy = (Math.random() - 0.5) * shake * 12;
    ctx.save();
    ctx.translate(sx, sy);

    // Generated water, shoreline, props, and fog
    const phase = getPhaseProgress();
    const phaseDef = PHASE_DEFS[phase.phase - 1];
    drawGeneratedWorld(phase, phaseDef);

    // Lane guides
    const laneHalf = getLaneHalfWidth();
    const laneLeft = worldToScreen(-laneHalf, 0).x;
    const laneRight = worldToScreen( laneHalf, 0).x;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(laneLeft, 0);
    ctx.lineTo(laneLeft, H);
    ctx.moveTo(laneRight, 0);
    ctx.lineTo(laneRight, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Distance markers (every 500u)
    for (let d = Math.floor(state.ship.y / 500) * 500; d < state.ship.y + VISIBLE_AHEAD; d += 500) {
      const p = worldToScreen(0, d);
      if (p.y < 0 || p.y > H) continue;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, p.y, W, 2);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${formatRunDistance(d)}`, 8, p.y - 4);
    }

    // Boss
    if (state.boss && state.bossActive) {
      drawBoss(state.boss);
    }

    // Obstacles
    for (const o of state.obstacles) {
      if (o.y < state.ship.y - VISIBLE_BEHIND) continue;
      if (o.y > state.ship.y + VISIBLE_AHEAD) continue;
      if (o.type === "mine") drawMine(o);
      else if (o.type === "sub") drawSub(o);
      else if (o.type === "rocket") drawRocket(o);
      else if (o.type === "drone") drawDrone(o);
      else if (o.type === "slick") drawSlick(o);
      else if (o.type === "container") drawContainer(o);
    }

    // Pickups
    for (const p of state.pickups) {
      if (p.y < state.ship.y - VISIBLE_BEHIND) continue;
      if (p.y > state.ship.y + VISIBLE_AHEAD) continue;
      drawBarrel(p.x, p.y, p.type);
    }

    // Splashes
    for (const sp of state.splashes) {
      const p = worldToScreen(sp.x, sp.y);
      if (p.y < -20 || p.y > H + 20) continue;
      const a = 1 - sp.age / sp.life;
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + sp.age * 18, 0, TAU);
      ctx.stroke();
    }

    // Particles
    for (const p of state.particles) {
      const s = worldToScreen(p.x, p.y);
      if (s.y < -20 || s.y > H + 20) continue;
      const a = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.fillRect(s.x - p.size / 2, s.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Ship
    if (!state.gameOver) drawShip();
    else if (state.gameOver && performance.now() - (state._dethTime || 0) < 500) drawShip();

    // Radar overlay
    if (state.activeUpgrades.radar) {
      drawRadar();
    }

    // Soap-bubble shield
    if (hasShield()) drawShield();

    // Restore
    ctx.restore();

    // Flash
    if (state.cam.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${state.cam.flash * 0.6})`;
      ctx.fillRect(0, 0, W, H);
      state.cam.flash = Math.max(0, state.cam.flash - 0.04);
    }

    // Phase banner
    if (state.bannerText && performance.now() < state.bannerUntil) {
      const el = document.getElementById("phase-banner");
      if (el) {
        el.textContent = state.bannerText;
        el.classList.add("phase-banner--show");
      }
    } else {
      const el = document.getElementById("phase-banner");
      if (el) el.classList.remove("phase-banner--show");
    }
  }

  function drawShip() {
    const s = state.ship;
    const screen = worldToScreen(s.x, s.y);
    const r = s.heading;

    // Wobble roll
    const wobble = Math.sin(performance.now() * 0.001 * SHIP_WOBBLE_FREQ) * SHIP_WOBBLE_AMP;
    const roll = wobble + (state.input.steer * 12);

    // I-frame flash
    if (s.flashing > 0 && Math.random() < 0.5) ctx.globalAlpha = 0.4;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    // Ship sprite is drawn with bow at -y (pointing up the strait).
    // With the new camera-relative controls, heading=0 means "moving forward",
    // so the rotation is just heading + the cosmetic roll. No π/2 offset.
    // NOTE: r is in radians, roll is in degrees.
    ctx.rotate(r + (roll * Math.PI / 180));
    ctx.scale(s.shipScale, s.shipScale);
    // (r is already radians; -r flips the heading for screen orientation)

    if (getArt("tanker")) {
      ctx.shadowColor = "rgba(46,224,255,0.22)";
      ctx.shadowBlur = state.activeUpgrades.turbo ? 12 : 5;
      drawArt("tanker", 0, 3, 42, 94);
      ctx.shadowBlur = 0;
      if (s.hull < s.maxHull) {
        ctx.strokeStyle = "#ff5c5c";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-8, -8); ctx.lineTo(-2, 0);
        ctx.moveTo(3, 10);  ctx.lineTo(10, 18);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // Hull body (orange tanker, low-poly)
    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.moveTo(-16, 18);
    ctx.lineTo(16, 18);
    ctx.lineTo(14, -12);
    ctx.lineTo(8, -22);
    ctx.lineTo(-8, -22);
    ctx.lineTo(-14, -12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bridge
    ctx.fillStyle = "#ffd180";
    ctx.fillRect(-7, -16, 14, 6);
    ctx.strokeRect(-7, -16, 14, 6);

    // Bridge windows
    ctx.fillStyle = "#2ee0ff";
    ctx.fillRect(-5, -14, 3, 2);
    ctx.fillRect(0,  -14, 3, 2);

    // Rubber duck on bow (the mascot)
    ctx.fillStyle = "#f7d716";
    ctx.beginPath();
    ctx.arc(0, -22, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.arc(2, -24, 2.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(2.5, -24, 0.8, 0, TAU);
    ctx.fill();
    // Duck beak
    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.moveTo(5, -23);
    ctx.lineTo(8, -22);
    ctx.lineTo(5, -21);
    ctx.closePath();
    ctx.fill();

    // Fuzzy dice hanging from bridge
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(-4, -10, 3, 3);
    ctx.fillRect(2, -10, 3, 3);
    ctx.fillStyle = "#fff";
    ctx.font = "3px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("•", -2.5, -7.5);
    ctx.fillText("•", 3.5, -7.5);

    // "TURBO" spoiler (cosmetic)
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(-12, 14, 24, 4);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 3px Arial";
    ctx.textAlign = "center";
    ctx.fillText("TURBO", 0, 17);

    // Hull damage indicator
    if (s.hull < s.maxHull) {
      ctx.strokeStyle = "#ff5c5c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(-4, 6);
      ctx.moveTo(0, -4);  ctx.lineTo(8, 4);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawHazardHalo(x, y, r, color) {
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.008);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.24 + pulse * 0.2;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawObjectTag(x, y, text, color, offsetY = -24) {
    ctx.save();
    ctx.font = "800 9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.max(26, ctx.measureText(text).width + 10);
    const tx = x;
    const ty = y + offsetY;
    ctx.fillStyle = "rgba(5,7,15,0.72)";
    roundRect(ctx, tx - w / 2, ty - 8, w, 16, 4);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#fbfaf4";
    ctx.fillText(text, tx, ty + 0.5);
    ctx.restore();
  }

  function drawMine(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -20 || s.y > H + 20) return;
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.006 + o.phase_offset);
    ctx.fillStyle = `rgba(255,92,92,${0.12 + pulse * 0.10})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, o.w * 0.88, 0, TAU);
    ctx.fill();
    if (drawArt("mine", s.x, s.y, o.w * 2.25, o.w * 2.25)) return;
    ctx.strokeStyle = "#2a0909";
    ctx.lineWidth = 2;
    const spikes = o.spikes || 8;
    for (let i = 0; i < spikes; i++) {
      const a = i / spikes * TAU + o.phase_offset * 0.15;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(a) * o.w * 0.42, s.y + Math.sin(a) * o.w * 0.42);
      ctx.lineTo(s.x + Math.cos(a) * o.w * 0.68, s.y + Math.sin(a) * o.w * 0.68);
      ctx.stroke();
    }
    // Barrel body
    ctx.fillStyle = "#7a241a";
    ctx.beginPath();
    ctx.arc(s.x, s.y, o.w * 0.5, 0, TAU);
    ctx.fill();
    // Bands
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - o.w * 0.5, s.y);
    ctx.lineTo(s.x + o.w * 0.5, s.y);
    ctx.stroke();
    // Face (permanent-marker eyes)
    const fy = s.y - 2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(s.x - 4, fy, 1.8, 0, TAU);
    ctx.arc(s.x + 4, fy, 1.8, 0, TAU);
    ctx.fill();
    // Mouth based on face state
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (o.face === "smug") {
      ctx.arc(s.x, fy + 4, 3, 0, Math.PI, false);
    } else if (o.face === "surprised") {
      ctx.arc(s.x, fy + 5, 2, 0, TAU);
    } else {
      ctx.moveTo(s.x - 3, fy + 5); ctx.lineTo(s.x + 3, fy + 5);
    }
    ctx.stroke();
    // Highlight
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.arc(s.x - o.w * 0.25, s.y - o.w * 0.25, 2, 0, TAU);
    ctx.fill();
  }

  function drawSub(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -20 || s.y > H + 20) return;
    drawHazardHalo(s.x, s.y, 31, "rgba(46,224,255,0.85)");
    drawObjectTag(s.x, s.y, "SUB", "#2ee0ff", -26);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(o.vy, o.vx) - Math.PI / 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, o.h * 0.55, o.w * 0.58, 7, 0, 0, TAU);
    ctx.fill();
    // Hull
    ctx.fillStyle = o.dove ? "#3a3a4a" : "#5a5a6a";
    roundRect(ctx, -o.w * 0.5, -o.h * 0.5, o.w, o.h, 6);
    ctx.fill();
    ctx.strokeStyle = "#0bf0ff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(-o.w * 0.34, -o.h * 0.28, o.w * 0.68, 4);
    // Conning tower
    ctx.fillStyle = "#2b2d38";
    roundRect(ctx, -7, -13, 14, 11, 4);
    ctx.fill();
    ctx.strokeStyle = "#050510";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#2ee0ff";
    ctx.font = "800 7px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SUB", 0, 2);
    // Googly eyes
    if (o.dove) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-3, -1, 2.5, 0, TAU);
      ctx.arc(3, -1, 2.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(-2.5 + o.dir, -1, 1, 0, TAU);
      ctx.arc(3.5 - o.dir, -1, 1, 0, TAU);
      ctx.fill();
    } else {
      // Periscope tell
      ctx.strokeStyle = "#d7fbff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(0, -22);
      ctx.lineTo(7 * o.dir, -22);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRocket(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -20 || s.y > H + 20) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    const ang = Math.atan2(o.vy, o.vx) + Math.PI / 2;
    ctx.rotate(ang);
    const streak = 30 + Math.min(38, Math.abs(o.vx) * 0.08);
    ctx.globalAlpha = 0.72;
    const exhaust = ctx.createLinearGradient(0, o.h * 0.34, 0, o.h * 0.34 + streak);
    exhaust.addColorStop(0, "rgba(255,140,26,0.90)");
    exhaust.addColorStop(0.34, "rgba(255,212,59,0.42)");
    exhaust.addColorStop(1, "rgba(255,92,92,0)");
    ctx.fillStyle = exhaust;
    ctx.beginPath();
    ctx.moveTo(-o.w * 0.46, o.h * 0.36);
    ctx.lineTo(0, o.h * 0.36 + streak + Math.random() * 8);
    ctx.lineTo(o.w * 0.46, o.h * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,212,59,0.38)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, o.h * 0.46);
    ctx.lineTo(0, o.h * 0.46 + streak * 0.75);
    ctx.stroke();
    // Body
    ctx.fillStyle = "#f5f2e9";
    roundRect(ctx, -o.w * 0.45, -o.h * 0.45, o.w * 0.9, o.h * 0.82, 5);
    ctx.fill();
    ctx.strokeStyle = "#050510"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#ff5c5c";
    ctx.beginPath();
    ctx.moveTo(0, -o.h * 0.62);
    ctx.lineTo(-o.w * 0.5, -o.h * 0.34);
    ctx.lineTo(o.w * 0.5, -o.h * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2ee0ff";
    ctx.fillRect(-o.w * 0.26, -o.h * 0.1, o.w * 0.52, 4);
    ctx.fillStyle = "#ff5c5c";
    ctx.beginPath();
    ctx.moveTo(-o.w * 0.45, o.h * 0.28);
    ctx.lineTo(-o.w * 0.95, o.h * 0.5);
    ctx.lineTo(-o.w * 0.38, o.h * 0.48);
    ctx.moveTo(o.w * 0.45, o.h * 0.28);
    ctx.lineTo(o.w * 0.95, o.h * 0.5);
    ctx.lineTo(o.w * 0.38, o.h * 0.48);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawDrone(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -24 || s.y > H + 24) return;
    const blink = 0.4 + 0.6 * Math.sin(performance.now() * 0.014 + o.blink);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(o.vy, o.vx) + Math.PI / 2);
    if (getArt("drone")) {
      ctx.shadowColor = `rgba(255,46,136,${0.22 + blink * 0.22})`;
      ctx.shadowBlur = 8;
      drawArt("drone", 0, 0, 58, 58);
      ctx.restore();
      return;
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 9, 20, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#050510";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 0); ctx.lineTo(18, 0);
    ctx.moveTo(0, -10); ctx.lineTo(0, 10);
    ctx.stroke();
    ctx.fillStyle = "#d9edf5";
    roundRect(ctx, -9, -7, 18, 14, 5);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.stroke();
    ctx.fillStyle = `rgba(255,46,136,${0.45 + blink * 0.45})`;
    for (const [px, py] of [[-18, 0], [18, 0], [0, -10], [0, 10]]) {
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#111124";
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }

  function drawSlick(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -40 || s.y > H + 40) return;
    const t = performance.now() * 0.001 + o.seed;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.sin(t) * 0.2 + o.spin * 0.2);
    const drewArt = drawArt("slick", 0, 0, o.w * 1.95, o.h * 2.35, 0.9);
    if (!drewArt) {
      const slick = ctx.createRadialGradient(0, 0, 2, 0, 0, o.w * 0.55);
      slick.addColorStop(0, "rgba(255,255,255,0.20)");
      slick.addColorStop(0.38, "rgba(46,224,255,0.24)");
      slick.addColorStop(0.68, "rgba(255,46,136,0.18)");
      slick.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = slick;
      ctx.beginPath();
      ctx.ellipse(0, 0, o.w * 0.5, o.h * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, o.w * 0.38, o.h * 0.34, Math.sin(t) * 0.4, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = "#b7ffef";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, o.w * 0.58, o.h * 0.6, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(5,7,15,0.7)";
    roundRect(ctx, -14, -7, 28, 14, 5);
    ctx.fill();
    ctx.strokeStyle = "#b7ffef";
    ctx.stroke();
    ctx.fillStyle = "#fbfaf4";
    ctx.font = "800 9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("OIL", 0, 1);
    ctx.restore();
  }

  function drawContainer(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -40 || s.y > H + 40) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.sin(o.age * 1.8 + o.seed) * 0.25);
    const drewArt = drawArt("container", 0, 0, o.w * 2.05, o.h * 2.35);
    if (!drewArt) {
      ctx.fillStyle = o.color || "#ff5c5c";
      roundRect(ctx, -o.w * 0.5, -o.h * 0.5, o.w, o.h, 3);
      ctx.fill();
      ctx.strokeStyle = "#050510";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      for (let x = -o.w * 0.35; x <= o.w * 0.36; x += o.w * 0.18) {
        ctx.beginPath();
        ctx.moveTo(x, -o.h * 0.45);
        ctx.lineTo(x, o.h * 0.45);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = "#ffd43b";
    ctx.lineWidth = 2.5;
    roundRect(ctx, -o.w * 0.58, -o.h * 0.62, o.w * 1.16, o.h * 1.24, 5);
    ctx.stroke();
    ctx.fillStyle = "rgba(5,7,15,0.72)";
    roundRect(ctx, -20, -8, 40, 16, 4);
    ctx.fill();
    ctx.strokeStyle = "#ffd43b";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#fbfaf4";
    ctx.font = "800 8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CARGO", 0, 1);
    ctx.restore();
  }

  function drawBoss(b) {
    const s = worldToScreen(b.x, b.y);
    if (s.y < -100 || s.y > H + 100) return;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + b.h * 0.5, b.w * 0.48, 18, 0, 0, TAU);
    ctx.fill();
    // Wide container block
    ctx.fillStyle = b.mode === "success" ? "#3a8a4a" : b.mode === "fail" ? "#8a3a3a" : "#5a3a2a";
    roundRect(ctx, s.x - b.w * 0.5, s.y - b.h * 0.5, b.w, b.h, 8);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Container ribs
    for (let i = 0; i < 11; i++) {
      const x = s.x - b.w * 0.5 + (i + 1) * b.w / 12;
      ctx.beginPath();
      ctx.moveTo(x, s.y - b.h * 0.5);
      ctx.lineTo(x, s.y + b.h * 0.5);
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const x = s.x - b.w * 0.42 + i * b.w / 7;
      ctx.fillStyle = i % 3 === 0 ? "#ff5c5c" : i % 3 === 1 ? "#2ee0ff" : "#ffd43b";
      roundRect(ctx, x, s.y - b.h * 0.38, b.w / 9, b.h * 0.28, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.stroke();
    }
    // Top text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Bungee, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(b.mode === "success" ? "LANE CLEAR!" : `HONK ${b.required - b.honks}`, s.x, s.y - b.h * 0.5 - 8);
  }

  function drawRadar() {
    // Highlight nearby obstacles
    for (const o of state.obstacles) {
      if (o.y < state.ship.y - 50) continue;
      if (o.y > state.ship.y + 80) continue;
      const s = worldToScreen(o.x, o.y);
      if (s.y < 0 || s.y > H) continue;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
      ctx.strokeStyle = `rgba(247,215,22,${0.4 + 0.4 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 18, 0, TAU);
      ctx.stroke();
      // Duck icon
      ctx.fillStyle = `rgba(247,215,22,${0.7 + 0.3 * pulse})`;
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🦆", s.x, s.y - 22);
    }
  }

  function drawShield() {
    const s = state.ship;
    const p = worldToScreen(s.x, s.y);
    const t = performance.now() * 0.003;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = "rgba(46,224,255,0.6)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 22 + i * 4, t + i, t + i + Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBarrel(wx, wy, type = "oil") {
    const s = worldToScreen(wx, wy);
    if (s.y < -20 || s.y > H + 20) return;
    // Glow
    const isPatch = type === "patch";
    ctx.fillStyle = isPatch ? "rgba(107,255,125,0.25)" : "rgba(247,215,22,0.25)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14, 0, TAU);
    ctx.fill();
    if (isPatch && drawArt("repairBuoy", s.x, s.y, 40, 40)) {
      ctx.fillStyle = "rgba(5,7,15,0.72)";
      roundRect(ctx, s.x - 18, s.y + 12, 36, 14, 4);
      ctx.fill();
      ctx.strokeStyle = "#6bff7d";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#fbfaf4";
      ctx.font = "800 8px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PATCH", s.x, s.y + 19);
      return;
    }
    // Barrel
    ctx.fillStyle = isPatch ? "#2f8a4a" : "#7a3a1a";
    if (isPatch) {
      roundRect(ctx, s.x - 10, s.y - 8, 20, 16, 4);
      ctx.fill();
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fbfaf4";
      ctx.fillRect(s.x - 6, s.y - 2, 12, 4);
      ctx.fillRect(s.x - 2, s.y - 6, 4, 12);
    } else {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "bold 6px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (!isPatch) ctx.fillText("OIL", s.x, s.y + 1);
  }

  // =========================================================================
  // 17. FRAME BUFFER for share card
  // =========================================================================

  function pushRingBuffer() {
    if (state.gameOver) return;
    const now = performance.now();
    if (now - state.lastRingPush < 100) return; // 10fps
    state.lastRingPush = now;

    // Draw ship + nearby obstacles to an offscreen canvas
    const off = document.createElement("canvas");
    off.width = 360; off.height = 360;
    const octx = off.getContext("2d");
    // Save current ctx, swap, draw, restore
    const savedTransform = ctx.getTransform();
    octx.fillStyle = "#0a3a5a";
    octx.fillRect(0, 0, off.width, off.height);
    // Draw the ship large in center
    octx.save();
    octx.translate(off.width / 2, off.height / 2 + 60);
    octx.scale(2.2, 2.2);
    octx.rotate(Math.PI / 2);
    // Inline mini-ship draw (simplified)
    octx.fillStyle = "#ff8c1a";
    octx.beginPath();
    octx.moveTo(-16, 18);
    octx.lineTo(16, 18);
    octx.lineTo(14, -12);
    octx.lineTo(8, -22);
    octx.lineTo(-8, -22);
    octx.lineTo(-14, -12);
    octx.closePath();
    octx.fill();
    octx.strokeStyle = "#000"; octx.lineWidth = 1.5; octx.stroke();
    octx.fillStyle = "#f7d716";
    octx.beginPath();
    octx.arc(0, -22, 6, 0, TAU);
    octx.fill();
    octx.restore();
    // Obstacles
    for (const o of state.obstacles) {
      if (o.y < state.ship.y - 50 || o.y > state.ship.y + 80) continue;
      const dx = (o.x - state.ship.x) * 1.0;
      const dy = (o.y - state.ship.y) * -0.7;
      octx.fillStyle = o.type === "mine" ? "#7a3a1a" : o.type === "sub" ? "#5a5a6a" : "#ddd";
      octx.beginPath();
      octx.arc(off.width / 2 + dx, off.height / 2 + dy + 60, 14, 0, TAU);
      octx.fill();
    }
    state.ringBuffer.push({ canvas: off, t: now });
    while (state.ringBuffer.length > 30) state.ringBuffer.shift();
  }

  // =========================================================================
  // 18. GAME LOOP
  // =========================================================================

  function enterSector(metrics) {
    const previous = state.sector;
    state.sector = metrics.sector;
    state.boss = null;
    state.bossActive = false;
    state.bossArmed = false;
    state.bossSpawnT = 0;
    const ghud = document.getElementById("boss-honkhud");
    if (ghud) ghud.style.display = "none";
    const repair = state.ship.hull < state.ship.maxHull ? 1 : 0;
    if (repair) state.ship.hull = Math.min(state.ship.maxHull, state.ship.hull + repair);
    const bonus = 900 + metrics.sector * 180;
    state.score += bonus;
    const unlocked = getNewHazardForSector(metrics.sector);
    state.bannerText = unlocked
      ? `SECTOR ${metrics.sector} · NEW: ${unlocked.label.toUpperCase()}`
      : `SECTOR ${metrics.sector} · ${getTheme(metrics.sector).name.toUpperCase()}`;
    state.bannerUntil = performance.now() + 2300;
    playSfx("phase");
    RB.toast(`Sector ${previous} escaped. +${bonus.toLocaleString()}${repair ? " · +1 hull" : ""}`, "good");
  }

  let rafId = null;
  function loop(now) {
    if (!state.running) return;
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    if (!state.paused && !state.gameOver && !state.inGate) {
      readInput();
      updateShip(dt);
      let metrics = getPhaseProgress();
      if (metrics.sector !== state.sector) {
        enterSector(metrics);
        metrics = getPhaseProgress();
      }
      state.phase = metrics.phase;
      state.sector = metrics.sector;
      state.threat = metrics.threat;

      updateBoss(dt);
      updateObstacles(dt);
      updatePickups(dt);
      updateParticles(dt);
      tickUpgrades();
      updateEngineHum();

      // Spawn obstacles based on phase
      if (state.phase < 5 || state.sector < BOSS_UNLOCK_SECTOR) {
        state._spawnT = (state._spawnT || 0) + dt;
        const def = PHASE_DEFS[state.phase - 1];
        const spawnEvery = Math.max(0.52, def.spawnEvery / Math.min(1.8, state.threat));
        while (state._spawnT >= spawnEvery) {
          state._spawnT -= spawnEvery;
          spawnObstacle();
          if (state.sector >= 5 && state.threat > 1.5 && Math.random() < Math.min(0.22, (state.threat - 1.4) * 0.10)) {
            spawnObstacle();
          }
          maybeSpawnPickup();
        }
      } else {
        // Phase 5 boss gates unlock after the core hazard families have been introduced.
        if (!state.bossArmed && state.sectorCleared !== state.sector) armBoss();
      }

      // Phase gates
      checkPhaseGates();

      // Phase transition banner
      const phaseKey = `${state.sector}:${state.phase}`;
      const prevPhase = state._lastPhaseDrawn || "";
      if (phaseKey !== prevPhase) {
        const def = PHASE_DEFS[state.phase - 1];
        state.bannerText = `SECTOR ${state.sector} · ${def.name}`;
        state.bannerUntil = performance.now() + 2000;
        playSfx("phase");
        state._lastPhaseDrawn = phaseKey;
      }

      // Score
      const scoreMult = state.activeUpgrades.fuzzyDice ? 2 : 1;
      state._scoreCarry = (state._scoreCarry || 0) + (24 + state.threat * 18) * scoreMult * dt;
      const addScore = Math.floor(state._scoreCarry);
      if (addScore > 0) {
        state.score += addScore;
        state._scoreCarry -= addScore;
      }

      // Frame buffer for share
      pushRingBuffer();
    } else {
      updateEngineHum();
      if (state.gameOver) updateParticles(dt);
    }

    // Decay
    if (state.cam.shake > 0) state.cam.shake = Math.max(0, state.cam.shake - dt * 3);
    if (state.ship.flashing > 0) state.ship.flashing = Math.max(0, state.ship.flashing - dt * 4);

    draw();
    updateHUD();
    rafId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // 19. HUD
  // =========================================================================

  function updateHUD() {
    const s = state.ship;
    const p = getPhaseProgress();
    document.getElementById("hud-score").textContent = state.score.toLocaleString();
    document.getElementById("hud-dist").textContent = formatRunDistance(state.distance);
    const sectorEl = document.getElementById("hud-sector");
    if (sectorEl) sectorEl.textContent = p.sector;
    document.getElementById("hud-phase").textContent = `${state.phase}`;
    const threatEl = document.getElementById("hud-threat");
    if (threatEl) threatEl.textContent = `${p.threat.toFixed(1)}x`;
    document.getElementById("hud-high").textContent = RB.getHighScore("hormuz").toLocaleString();
    const miniScore = document.getElementById("mini-score");
    if (miniScore) miniScore.textContent = state.score.toLocaleString();
    const miniSector = document.getElementById("mini-sector");
    if (miniSector) miniSector.textContent = p.sector;
    const miniHull = document.getElementById("mini-hull");
    if (miniHull) miniHull.textContent = `${s.hull}/${s.maxHull}`;

    // Hull pips
    const hullEl = document.getElementById("hud-hull");
    if (hullEl) {
      let html = "";
      for (let i = 0; i < s.maxHull; i++) {
        let state_attr = "good";
        if (i >= s.hull) state_attr = "lost";
        else if (s.hull === 1) state_attr = "critical";
        else if (i === s.hull - 1) state_attr = "damaged";
        html += `<span class="hull-pip" data-state="${state_attr}"></span>`;
      }
      hullEl.innerHTML = html;
    }
  }

  // =========================================================================
  // 20. STATE MANAGEMENT
  // =========================================================================

  function startGame() {
    if (saveSlot) saveSlot.clear();
    // Reset
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.started = true;
    state.score = 0;
    state.distance = 0;
    state.phase = 1;
    state.sector = 1;
    state.threat = 1;
    state.assetSeed = Math.floor(Math.random() * 999999);
    state.ship = {
      x: 0, y: 0, vx: 0, vy: 0,
      heading: 0, angVel: 0,
      hull: HULL_MAX, maxHull: HULL_MAX,
      iframe: 0, hornCooldown: 0, flashing: 0,
      shipScale: 1, turboMult: 1, plated: false
    };
    state.obstacles = [];
    state.pickups = [];
    state.particles = [];
    state.splashes = [];
    state.boss = null;
    state.bossActive = false;
    state.bossArmed = false;
    state.bossSector = 0;
    state.sectorCleared = 0;
    state.bossSpawnT = 0;
    state.phaseGatesHit = new Set();
    state.inGate = false;
    state.activeUpgrades = {};
    state.cam.shake = 0; state.cam.flash = 0;
    state.ringBuffer = [];
    state._spawnT = 0;
    state._scoreCarry = 0;
    state._lastPhaseDrawn = "";
    state._dethTime = 0;
    state.lastCauseOfDeath = "";

    // Clear wipeout card
    const mount = document.getElementById("wipeout-mount");
    if (mount) mount.innerHTML = "";
    const ghud = document.getElementById("boss-honkhud");
    if (ghud) ghud.style.display = "none";

    hideOverlay();
    ensureAudio();
    if (audio.ctx?.state === "suspended") audio.ctx.resume();
    playSfx("start");
    updateHUD();
    canvas.focus();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function snapshot() {
    const now = performance.now() / 1000;
    const activeUpgrades = {};
    Object.keys(state.activeUpgrades).forEach((key) => {
      activeUpgrades[key] = Math.max(0, state.activeUpgrades[key] - now);
    });
    return {
      score: state.score,
      distance: state.distance,
      phase: state.phase,
      sector: state.sector,
      threat: state.threat,
      assetSeed: state.assetSeed,
      ship: { ...state.ship },
      phaseGatesHit: Array.from(state.phaseGatesHit),
      activeUpgrades,
      bossActive: state.bossActive,
      bossArmed: state.bossArmed,
      bossSector: state.bossSector,
      sectorCleared: state.sectorCleared,
    };
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data) return;
    const now = performance.now() / 1000;
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.started = true;
    state.score = Number(data.score) || 0;
    state.distance = Math.max(0, Number(data.distance) || 0);
    state.assetSeed = Number(data.assetSeed) || Math.floor(Math.random() * 999999);
    const restoredMetrics = getPhaseProgress();
    state.sector = restoredMetrics.sector;
    state.phase = restoredMetrics.phase;
    state.threat = restoredMetrics.threat;
    state.ship = {
      x: 0, y: state.distance, vx: 0, vy: 0,
      heading: 0, angVel: 0,
      hull: HULL_MAX, maxHull: HULL_MAX,
      iframe: 0, hornCooldown: 0, flashing: 0,
      shipScale: 1, turboMult: 1, plated: false,
      ...(data.ship || {}),
    };
    state.obstacles = [];
    state.pickups = [];
    state.particles = [];
    state.splashes = [];
    state.boss = null;
    state.bossActive = false;
    state.bossArmed = false;
    state.bossSector = 0;
    state.sectorCleared = Number(data.sectorCleared) || 0;
    state.bossSpawnT = 0;
    state.phaseGatesHit = new Set(Array.isArray(data.phaseGatesHit) ? data.phaseGatesHit : []);
    state.inGate = false;
    state.activeUpgrades = {};
    Object.entries(data.activeUpgrades || {}).forEach(([key, remaining]) => {
      if (Number(remaining) > 0) state.activeUpgrades[key] = now + Number(remaining);
    });
    state.cam.shake = 0; state.cam.flash = 0;
    state.ringBuffer = [];
    state._spawnT = 0;
    state._scoreCarry = 0;
    state._lastPhaseDrawn = "";
    state._dethTime = 0;
    state.lastCauseOfDeath = "";
    const mount = document.getElementById("wipeout-mount");
    if (mount) mount.innerHTML = "";
    const ghud = document.getElementById("boss-honkhud");
    if (ghud) ghud.style.display = "none";
    hideOverlay();
    ensureAudio();
    if (audio.ctx?.state === "suspended") audio.ctx.resume();
    playSfx("start");
    updateHUD();
    canvas.focus();
    if (rafId) cancelAnimationFrame(rafId);
    state.lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function pauseGame() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
  }

  function showOverlay(title, sub, btn, showScore) {
    const ov = document.getElementById("overlay");
    document.getElementById("overlay-title").textContent = title;
    document.getElementById("overlay-sub").innerHTML = sub;
    const scoreEl = document.getElementById("overlay-score");
    if (showScore) {
      scoreEl.style.display = "block";
      scoreEl.innerHTML = `Score: <strong style="color:var(--accent-3)">${state.score.toLocaleString()}</strong> · High: <strong>${RB.getHighScore("hormuz").toLocaleString()}</strong> · Run: <strong>${formatRunDistance(state.distance)}</strong> · Sector: <strong>${getPhaseProgress().sector}</strong>`;
    } else {
      scoreEl.style.display = "none";
    }
    document.getElementById("btn-primary").textContent = btn;
    ov.classList.add("overlay--show");
  }
  function hideOverlay() { document.getElementById("overlay").classList.remove("overlay--show"); }

  // =========================================================================
  // 21. POWER-UP LEGACY (the old shield/boost/nuke lives in RB.state.powerups
  //     but we don't use them in v3 — the new ad-wall loop supersedes them.
  //     We render the old panel anyway so RB.subscribe(renderPowerups) in the
  //     parent site still works without errors.
  // =========================================================================
  function renderPowerups() {
    const slot = document.getElementById("powerups");
    if (!slot) return;
    const now = performance.now() / 1000;
    const items = [
      { key: "turbo",     icon: "🌀", label: "Turbo" },
      { key: "shield",    icon: "🫧", label: "Shield" },
      { key: "radar",     icon: "🦆", label: "Radar" },
      { key: "plating",   icon: "🩹", label: "Plating" },
      { key: "fuzzyDice", icon: "🎲", label: "Dice" }
    ];
    slot.innerHTML = items.map((it) => {
      const expires = state.activeUpgrades[it.key];
      const active = expires != null;
      const permanent = it.key === "plating" && active;
      const ready = it.key === "shield" && active;
      const remaining = ready ? "READY" : active && !permanent ? Math.max(0, Math.ceil(expires - now)) + "S" : active ? "ON" : "AD WALL";
      return `
      <div class="powerup ${active ? "" : "powerup--locked"}" title="${UPGRADES[it.key].desc}">
        <span class="powerup__icon">${it.icon}</span>
        <span class="powerup__label">${it.label}</span>
        <span class="powerup__cost">${remaining}</span>
      </div>
    `;
    }).join("");
  }

  function bindFullscreen() {
    const fsBtn = document.getElementById("btn-fullscreen");
    const fsTarget = canvas.closest(".canvas-wrap");
    if (!fsBtn || !fsTarget) return;
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const updateButton = () => {
      const on = isMaxed();
      fsBtn.textContent = on ? "x" : "⛶";
      fsBtn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      fsBtn.setAttribute("title", on ? "Exit max screen" : "Max screen");
    };
    const setMaxed = (on) => {
      fsTarget.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      updateButton();
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        if (on) canvas.focus();
      });
    };
    const toggle = () => {
      ensureAudio();
      const on = !isMaxed();
      setMaxed(on);
      if (on) {
        const req = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
        if (req) {
          try {
            const ret = req.call(fsTarget);
            if (ret && ret.catch) ret.catch(() => {});
          } catch (_) {}
        }
      } else if (nativeFsEl()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          try { exit.call(document); } catch (_) {}
        }
      }
    };
    fsBtn.addEventListener("click", toggle);
    const onNativeFsChange = () => { if (!nativeFsEl() && isMaxed()) setMaxed(false); };
    document.addEventListener("fullscreenchange", onNativeFsChange);
    document.addEventListener("webkitfullscreenchange", onNativeFsChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMaxed() && !nativeFsEl()) setMaxed(false);
    });
    updateButton();
  }

  // =========================================================================
  // 22. WIRING
  // =========================================================================

  document.getElementById("btn-primary").addEventListener("click", startGame);
  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-sound").addEventListener("click", () => setSoundEnabled(!audio.enabled));
  document.getElementById("btn-restart").addEventListener("click", () => {
    showOverlay(
      "⛴ RESTART?",
      "Restart the voyage? Your tanker can take it. (Probably.)",
      "Start voyage"
    );
    if (saveMenu) saveMenu.refresh();
  });
  if (saveSlot) {
    saveMenu = saveSlot.attachButtons({
      primary: document.getElementById("btn-primary"),
      scoreEl: document.getElementById("overlay-score"),
      continueLabel: "Continue voyage",
      newLabel: "New voyage",
      onContinue: restoreGame,
      summary: (saved) => {
        const data = saved.data || {};
        const distance = Number(data.distance || 0);
        const sector = Math.max(1, Math.floor(distance / SECTOR_LENGTH) + 1);
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Run <strong>${formatRunDistance(distance)}</strong> · Sector <strong>${sector}</strong> · Score <strong>${Number(data.score || 0).toLocaleString()}</strong>`;
      },
    });
    saveSlot.startAutosave(snapshot, () => state.running && !state.gameOver);
  }
  bindFullscreen();

  RB.subscribe(renderPowerups);
  setupTouch();
  updateSoundButton();
  updateHUD();
  renderPowerups();

  // First paint of the world (so the canvas isn't blank behind the overlay)
  draw();
})();
