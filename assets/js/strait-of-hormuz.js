/* ==========================================================================
   ESCAPE THE STRAIGHT (STRAIT OF HORMUZ) — HIGH-OCTANE MARITIME DODGER
   --------------------------------------------------------------------------
   Definitive tactical naval dodger:
   - In-Game HUD: Score, Distance, Sector, Hull, Multiplier & Powerups
     rendered directly within the gameplay screen.
   - Steer an oil tanker through the hostile Strait of Hormuz.
   - Continuous Swept-Ray Collision Detection (CCD) for 100% reliable hits.
   - Advance Laser Lock-On Warnings (1.4-1.8s) for fair, readable missile dodging.
   - 3 Core Threat Families: Naval Mines, Anti-Ship Missiles, Terrorist Skiffs.
   - Helpful Pickups: Oil Barrels (score multiplier frenzy), Repair Buoys,
     Deflector Shields, Turbo Propellers.
   - High-fidelity procedural Persian Gulf water, wake dynamics, particle FX.
   - Procedural Web Audio engine with diesel engine, horn, explosions, tracers.
   - Progressive Sector Difficulty scaling from calm gulf to all-out warzone.
   ========================================================================== */

(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // =========================================================================
  // 1. CONFIGURATION & TUNING
  // =========================================================================

  const SECTOR_LENGTH = 5400;          // World units per sector (~6.75 NM)
  const NAUTICAL_MILE_UNITS = 800;     // 800 world units = 1.0 Nautical Mile
  const VISIBLE_AHEAD = 580;           // Forward render distance
  const VISIBLE_BEHIND = 240;          // Aft render distance

  // Ship Physics & Controls
  const SHIP_BASE_THRUST = 220;        // Forward acceleration (u/s²)
  const SHIP_BASE_STRAFE = 230;        // Lateral rudder acceleration (u/s² - responsive dodging)
  const SHIP_BASE_MAX_SPEED = 185;     // Cruising speed cap (u/s)
  const SHIP_LINEAR_DAMP = 0.86;       // Water drag (responsive yet floaty)
  const SHIP_RUDDER_RESPONSE = 6.0;    // Visual heading interpolation rate
  const SHIP_COLLISION_W = 15;         // Hitbox half-width (30px total)
  const SHIP_COLLISION_L = 38;         // Hitbox half-length (76px total)
  const HULL_MAX = 3;                  // Standard hull segments
  const IFRAME_DURATION = 1.6;         // Seconds of post-hit invulnerability
  const HORN_COOLDOWN = 1.2;           // Cooldown between horn/flare blasts
  const HORN_RADIUS = 160;             // Generous countermeasure blast clearing radius

  // Progressive Sectors
  const SECTOR_DEFS = [
    {
      id: 1,
      name: "GULF APPROACH",
      tagline: "Calm Waters · Mine Reconnaissance",
      width: 220,
      threat: 1.0,
      spawnInterval: 1.70,
      missileWarningTime: 1.8,
      missileSpeed: 230,
      mix: { mine: 0.80, missile: 0.20, terrorist: 0.00 },
      waterTop: "#0a4b64",
      waterMid: "#063045",
      waterBot: "#031a29",
      glow: "#2ee0ff",
      fog: 0.0,
      storm: false
    },
    {
      id: 2,
      name: "KISH & QESHM",
      tagline: "Channel Narrows · Terrorist Skiffs Sighted",
      width: 195,
      threat: 1.30,
      spawnInterval: 1.35,
      missileWarningTime: 1.6,
      missileSpeed: 255,
      mix: { mine: 0.55, missile: 0.25, terrorist: 0.20 },
      waterTop: "#0d5568",
      waterMid: "#083748",
      waterBot: "#041e2b",
      glow: "#ffd43b",
      fog: 0.08,
      storm: false
    },
    {
      id: 3,
      name: "THE NARROWS",
      tagline: "Hostile Chokepoint · Missile Batteries Active",
      width: 170,
      threat: 1.65,
      spawnInterval: 1.10,
      missileWarningTime: 1.4,
      missileSpeed: 280,
      mix: { mine: 0.40, missile: 0.35, terrorist: 0.25 },
      waterTop: "#123c52",
      waterMid: "#092434",
      waterBot: "#04141e",
      glow: "#ff8c1a",
      fog: 0.16,
      storm: false
    },
    {
      id: 4,
      name: "NIGHT BLOCKADE",
      tagline: "Stormy Waters · Gunboat Wolfpacks",
      width: 155,
      threat: 2.10,
      spawnInterval: 0.90,
      missileWarningTime: 1.3,
      missileSpeed: 305,
      mix: { mine: 0.32, missile: 0.38, terrorist: 0.30 },
      waterTop: "#091c2c",
      waterMid: "#05111c",
      waterBot: "#02070e",
      glow: "#ff3b56",
      fog: 0.28,
      storm: true
    },
    {
      id: 5,
      name: "WARZONE HORIZON",
      tagline: "Total Blockade · Maximum Evasion",
      width: 140,
      threat: 2.60,
      spawnInterval: 0.75,
      missileWarningTime: 1.2,
      missileSpeed: 330,
      mix: { mine: 0.30, missile: 0.40, terrorist: 0.30 },
      waterTop: "#1a162b",
      waterMid: "#0d0a17",
      waterBot: "#05040a",
      glow: "#ff2e88",
      fog: 0.22,
      storm: true
    }
  ];

  // =========================================================================
  // 2. GAME STATE
  // =========================================================================

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    started: false,

    score: 0,
    distance: 0,              // Current Y in world coordinates
    sector: 1,
    threat: 1.0,
    multiplier: 1.0,
    cargoCombo: 0,            // Barrels collected for combo

    // Ship
    ship: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      roll: 0,
      hull: HULL_MAX,
      maxHull: HULL_MAX,
      iframe: 0,
      hornCooldown: 0,
      turboTimer: 0,
      hasShield: false,
      flaresReady: true
    },

    // Input state
    input: {
      throttle: 0,
      steer: 0,
      horn: false
    },

    // Active entities
    hazards: [],              // Mines, In-flight Missiles, Terrorist Skiffs
    pendingMissiles: [],      // Missiles in laser lock-on warning phase
    projectiles: [],          // Bullets fired by terrorists
    pickups: [],              // Oil barrels, Repair kits, Shields, Turbos
    particles: [],            // Fire, smoke, water splashes, sparkles
    wakes: [],                // Dynamic trailing boat wake ripples
    shockwaves: [],           // Horn / explosion distortion rings

    // Notifications
    nearMissText: "",
    nearMissUntil: 0,
    bannerText: "",
    bannerUntil: 0,

    // Camera FX
    camShake: 0,
    screenFlash: 0,
    lightningTimer: 0,

    // Spawn clocks
    spawnClock: 0,
    pickupClock: 0,
    lastFrameTime: 0,
    lastCauseOfDeath: "Enemy Fire"
  };

  const saveSlot = window.RBGameSaves && window.RBGameSaves.create("hormuz", { version: 2 });

  // =========================================================================
  // 3. PROCEDURAL WEB AUDIO ENGINE
  // =========================================================================

  const audio = {
    ctx: null,
    master: null,
    engineOsc1: null,
    engineOsc2: null,
    engineGain: null,
    engineFilter: null,
    enabled: localStorage.getItem("rb-hormuz-sound") !== "off"
  };

  function initAudio() {
    if (!audio.enabled || audio.ctx) return audio.ctx;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      audio.ctx = new AudioCtx();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.26;
      audio.master.connect(audio.ctx.destination);

      // Marine Diesel Engine Synth
      audio.engineOsc1 = audio.ctx.createOscillator();
      audio.engineOsc2 = audio.ctx.createOscillator();
      audio.engineGain = audio.ctx.createGain();
      audio.engineFilter = audio.ctx.createBiquadFilter();

      audio.engineOsc1.type = "sawtooth";
      audio.engineOsc2.type = "triangle";
      audio.engineOsc1.frequency.value = 32;
      audio.engineOsc2.frequency.value = 64;

      audio.engineFilter.type = "lowpass";
      audio.engineFilter.frequency.value = 160;
      audio.engineGain.gain.value = 0;

      audio.engineOsc1.connect(audio.engineFilter);
      audio.engineOsc2.connect(audio.engineFilter);
      audio.engineFilter.connect(audio.engineGain);
      audio.engineGain.connect(audio.master);

      audio.engineOsc1.start();
      audio.engineOsc2.start();

      updateSoundButton();
      return audio.ctx;
    } catch (e) {
      audio.enabled = false;
      return null;
    }
  }

  function updateEngineAudio() {
    if (!audio.ctx || !audio.engineGain) return;
    if (!state.running || state.paused || state.gameOver || !audio.enabled) {
      audio.engineGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05);
      return;
    }
    const speed = Math.hypot(state.ship.vx, state.ship.vy);
    const speedRatio = clamp(speed / SHIP_BASE_MAX_SPEED, 0, 1.6);
    const targetGain = 0.04 + speedRatio * 0.06;
    const targetFreq = 28 + speedRatio * 34 + state.threat * 4;

    audio.engineGain.gain.setTargetAtTime(targetGain, audio.ctx.currentTime, 0.08);
    audio.engineOsc1.frequency.setTargetAtTime(targetFreq, audio.ctx.currentTime, 0.08);
    audio.engineOsc2.frequency.setTargetAtTime(targetFreq * 2, audio.ctx.currentTime, 0.08);
    audio.engineFilter.frequency.setTargetAtTime(140 + speedRatio * 180, audio.ctx.currentTime, 0.08);
  }

  function playTone(freq, dur = 0.15, type = "sine", gainVal = 0.2, delay = 0) {
    if (!audio.enabled) return;
    const actx = initAudio();
    if (!actx || !audio.master) return;
    const t = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainVal, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function playNoise(dur = 0.3, gainVal = 0.25, filterFreq = 600) {
    if (!audio.enabled) return;
    const actx = initAudio();
    if (!actx || !audio.master) return;
    const buffer = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = actx.createBufferSource();
    src.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;

    const g = actx.createGain();
    g.gain.setValueAtTime(gainVal, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(audio.master);
    src.start();
  }

  function playSfx(type) {
    if (!audio.enabled) return;
    switch (type) {
      case "horn":
        // Deep resonant maritime foghorn
        playTone(130, 0.55, "sawtooth", 0.24);
        playTone(195, 0.50, "triangle", 0.16, 0.02);
        playTone(97,  0.60, "square",   0.14, 0.04);
        break;

      case "lock_on":
        // Tactical missile lock-on warning chirp
        playTone(880, 0.08, "square", 0.12);
        playTone(1200, 0.10, "square", 0.14, 0.06);
        break;

      case "explosion":
        playNoise(0.65, 0.38, 420);
        playTone(65, 0.5, "sawtooth", 0.32);
        break;

      case "missile_launch":
        playTone(280, 0.18, "sawtooth", 0.14);
        playTone(620, 0.28, "sine", 0.16, 0.04);
        playNoise(0.25, 0.15, 1200);
        break;

      case "gunfire":
        playNoise(0.08, 0.22, 1800);
        playTone(180, 0.06, "square", 0.14);
        break;

      case "barrel":
        // Melodic oil pickup chime
        playTone(523.25, 0.10, "sine", 0.16);
        playTone(659.25, 0.12, "sine", 0.18, 0.06);
        playTone(783.99, 0.18, "sine", 0.20, 0.12);
        break;

      case "repair":
        playTone(440, 0.10, "triangle", 0.15);
        playTone(554.37, 0.12, "triangle", 0.18, 0.08);
        playTone(659.25, 0.14, "triangle", 0.20, 0.16);
        playTone(880, 0.22, "sine", 0.22, 0.24);
        break;

      case "powerup":
        playTone(392, 0.08, "square", 0.14);
        playTone(587.33, 0.10, "square", 0.16, 0.08);
        playTone(783.99, 0.16, "triangle", 0.18, 0.16);
        break;

      case "hit":
        playNoise(0.25, 0.30, 700);
        playTone(92, 0.25, "sawtooth", 0.26);
        break;

      case "sector":
        playTone(329.63, 0.12, "triangle", 0.16);
        playTone(493.88, 0.14, "triangle", 0.18, 0.10);
        playTone(659.25, 0.22, "sine", 0.22, 0.20);
        break;

      case "near_miss":
        playTone(880, 0.06, "sine", 0.12);
        playTone(1174.66, 0.08, "sine", 0.10, 0.04);
        break;
    }
  }

  function setSoundEnabled(enabled) {
    audio.enabled = enabled;
    localStorage.setItem("rb-hormuz-sound", enabled ? "on" : "off");
    updateSoundButton();
    if (enabled) {
      initAudio();
      if (audio.ctx?.state === "suspended") audio.ctx.resume();
      RB.toast("Sound enabled", "good");
    } else {
      if (audio.engineGain) audio.engineGain.gain.value = 0;
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
  // 4. MATH & UTILITIES
  // =========================================================================

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const randi = (min, max) => Math.floor(rand(min, max));
  const TAU = Math.PI * 2;

  function getSectorData(dist = state.distance) {
    const sectorIdx = clamp(Math.floor(dist / SECTOR_LENGTH), 0, SECTOR_DEFS.length - 1);
    const sectorDef = SECTOR_DEFS[sectorIdx];
    const sectorStart = sectorIdx * SECTOR_LENGTH;
    const progress = clamp((dist - sectorStart) / SECTOR_LENGTH, 0, 1);
    const threat = sectorDef.threat + progress * 0.30;
    const laneWidth = Math.max(125, sectorDef.width - progress * 15);
    return {
      sectorNumber: sectorIdx + 1,
      sectorDef,
      progress,
      threat,
      laneHalfWidth: laneWidth
    };
  }

  function worldToScreen(wx, wy) {
    const camY = state.ship.y;
    return {
      x: W * 0.5 + wx,
      y: H * 0.65 - (wy - camY)
    };
  }

  function distSqToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex = px - x1, ey = py - y1;
      return ex * ex + ey * ey;
    }
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const rx = px - projX;
    const ry = py - projY;
    return rx * rx + ry * ry;
  }

  function checkSweptCapsuleCollision(prevX, prevY, currX, currY, projRadius) {
    const s = state.ship;
    const rad = SHIP_COLLISION_W;
    const offsets = [-SHIP_COLLISION_L * 0.65, 0, SHIP_COLLISION_L * 0.65];
    const cosH = Math.cos(s.heading + Math.PI / 2);
    const sinH = Math.sin(s.heading + Math.PI / 2);

    for (const off of offsets) {
      const cx = s.x + sinH * off;
      const cy = s.y - cosH * off;
      const combinedRadius = rad + projRadius;
      if (distSqToSegment(cx, cy, prevX, prevY, currX, currY) <= combinedRadius * combinedRadius) {
        return true;
      }
    }
    return false;
  }

  function isInsideBoat(px, py, extraRadius = 0) {
    const s = state.ship;
    const rad = SHIP_COLLISION_W + extraRadius;
    const offsets = [-SHIP_COLLISION_L * 0.6, 0, SHIP_COLLISION_L * 0.6];
    const cosH = Math.cos(s.heading + Math.PI / 2);
    const sinH = Math.sin(s.heading + Math.PI / 2);

    for (const off of offsets) {
      const cx = s.x + sinH * off;
      const cy = s.y - cosH * off;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= rad * rad) return true;
    }
    return false;
  }

  // =========================================================================
  // 5. INPUT HANDLING
  // =========================================================================

  const keys = {};

  window.addEventListener("keydown", (e) => {
    if (e.target?.matches?.("input, textarea, select, [contenteditable='true']")) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyS", "KeyA", "KeyD"].includes(e.code)) {
      e.preventDefault();
    }
    keys[e.code] = true;
    if (audio.enabled) {
      initAudio();
      if (audio.ctx?.state === "suspended") audio.ctx.resume();
    }
    if (e.code === "Space" && state.running && !state.paused && !state.gameOver) {
      triggerHornFlares();
    }
    if ((e.code === "KeyP") && state.running && !state.gameOver) {
      togglePause();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.target?.matches?.("input, textarea, select, [contenteditable='true']")) return;
    keys[e.code] = false;
  });

  function readInput() {
    let throttle = 0;
    let steer = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) throttle += 1;
    if (keys["KeyS"] || keys["ArrowDown"]) throttle -= 1;
    if (keys["KeyA"] || keys["ArrowLeft"]) steer -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) steer += 1;

    state.input.throttle = throttle;
    state.input.steer = steer;
  }

  function setupTouchControls() {
    const setControl = (ctrl, isDown) => {
      const map = {
        thrust: "KeyW",
        brake:  "KeyS",
        left:   "KeyA",
        right:  "KeyD"
      };
      if (ctrl === "horn" && isDown) {
        triggerHornFlares();
        return;
      }
      if (ctrl === "pause" && isDown) {
        togglePause();
        return;
      }
      const code = map[ctrl];
      if (code) keys[code] = isDown;
    };

    document.querySelectorAll("[data-strait-controls] button[data-ctrl]").forEach((btn) => {
      const ctrl = btn.dataset.ctrl;
      const onDown = (e) => { e.preventDefault(); setControl(ctrl, true); };
      const onUp   = (e) => { e.preventDefault(); setControl(ctrl, false); };
      btn.addEventListener("touchstart", onDown, { passive: false });
      btn.addEventListener("touchend", onUp, { passive: false });
      btn.addEventListener("touchcancel", onUp, { passive: false });
      btn.addEventListener("mousedown", onDown);
      btn.addEventListener("mouseup", onUp);
      btn.addEventListener("mouseleave", onUp);
    });
  }

  // =========================================================================
  // 6. SHIP DYNAMICS & HULL SYSTEM
  // =========================================================================

  function updateShip(dt) {
    if (state.gameOver) return;
    const s = state.ship;
    const sectorData = getSectorData();
    const laneHalf = sectorData.laneHalfWidth;

    // Timers
    if (s.iframe > 0) s.iframe = Math.max(0, s.iframe - dt);
    if (s.hornCooldown > 0) s.hornCooldown = Math.max(0, s.hornCooldown - dt);
    if (s.turboTimer > 0) {
      s.turboTimer = Math.max(0, s.turboTimer - dt);
      if (s.turboTimer <= 0) {
        RB.toast("⚡ Turbo Propeller Expired", "");
        updatePowerupUI();
      }
    }

    // Accelerations (Responsive Rudder & Throttle)
    const turboMult = s.turboTimer > 0 ? 1.45 : 1.0;
    const forwardAcc = (state.input.throttle * SHIP_BASE_THRUST + 130) * turboMult;
    const lateralAcc = state.input.steer * SHIP_BASE_STRAFE * turboMult;

    s.vy += forwardAcc * dt;
    s.vx += lateralAcc * dt;

    // Linear damping / Water drag
    s.vx *= Math.max(0, 1 - SHIP_LINEAR_DAMP * dt);
    s.vy *= Math.max(0, 1 - SHIP_LINEAR_DAMP * dt * 0.7);

    // Speed Cap
    const maxSpd = SHIP_BASE_MAX_SPEED * turboMult;
    const currentSpeed = Math.hypot(s.vx, s.vy);
    if (currentSpeed > maxSpd) {
      s.vx = (s.vx / currentSpeed) * maxSpd;
      s.vy = (s.vy / currentSpeed) * maxSpd;
    }

    // Position updates
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    state.distance = s.y;

    // Lane constraint & channel bank bumper
    if (s.x < -laneHalf) {
      s.x = -laneHalf;
      s.vx = Math.abs(s.vx) * 0.4;
      spawnWaterSplash(s.x - 10, s.y, 8, "#2ee0ff");
      state.camShake = Math.max(state.camShake, 0.08);
    } else if (s.x > laneHalf) {
      s.x = laneHalf;
      s.vx = -Math.abs(s.vx) * 0.4;
      spawnWaterSplash(s.x + 10, s.y, 8, "#2ee0ff");
      state.camShake = Math.max(state.camShake, 0.08);
    }

    // Visual heading & roll tilt
    let targetHeading = 0;
    if (currentSpeed > 10) {
      targetHeading = Math.atan2(s.vx, s.vy);
    }
    s.heading += (targetHeading - s.heading) * Math.min(1, dt * SHIP_RUDDER_RESPONSE);
    s.roll += ((state.input.steer * 0.18) - s.roll) * Math.min(1, dt * 6.0);

    // Dynamic Wake generation
    if (currentSpeed > 35 && Math.random() < 0.65) {
      state.wakes.push({
        x: s.x,
        y: s.y - 36,
        vx: s.vx * 0.15,
        vy: s.vy * 0.1,
        width: 14,
        maxLife: 1.4,
        life: 1.4,
        heading: s.heading
      });
    }

    // Bow Spray
    if (currentSpeed > 120 && Math.random() < 0.4) {
      spawnWaterSplash(s.x, s.y + 35, 2, "rgba(255, 255, 255, 0.7)", 40);
    }

    // Damage Smoke / Fire on hull
    if (s.hull === 2 && Math.random() < 0.25) {
      spawnSmokePuff(s.x + rand(-6, 6), s.y - 12, "rgba(200, 210, 220, 0.4)", 8);
    } else if (s.hull === 1) {
      if (Math.random() < 0.5) spawnSmokePuff(s.x + rand(-6, 6), s.y - 12, "rgba(40, 40, 40, 0.8)", 12);
      if (Math.random() < 0.2) spawnFireSpark(s.x + rand(-5, 5), s.y - 14);
    }
  }

  // =========================================================================
  // 7. COUNTERMEASURES & HORN BLAST
  // =========================================================================

  function triggerHornFlares() {
    initAudio();
    const s = state.ship;
    if (s.hornCooldown > 0) return;
    s.hornCooldown = HORN_COOLDOWN;
    playSfx("horn");

    // Create acoustic shockwave ring
    state.shockwaves.push({
      x: s.x,
      y: s.y,
      radius: 10,
      maxRadius: HORN_RADIUS * 1.35,
      life: 0.55,
      maxLife: 0.55
    });

    state.camShake = Math.max(state.camShake, 0.25);

    let clearedCount = 0;

    // 1. Deflect in-flight hazards
    for (let i = state.hazards.length - 1; i >= 0; i--) {
      const h = state.hazards[i];
      const d = Math.hypot(s.x - h.x, s.y - h.y);
      if (d <= HORN_RADIUS) {
        if (h.type === "mine") {
          detonateMine(h, true);
          clearedCount++;
        } else if (h.type === "missile") {
          detonateMissile(h, true);
          clearedCount++;
        } else if (h.type === "terrorist") {
          damageTerrorist(h, 99, true);
          clearedCount++;
        }
      }
    }

    // 2. Clear pending locked-on missiles targeting near ship
    for (let i = state.pendingMissiles.length - 1; i >= 0; i--) {
      const m = state.pendingMissiles[i];
      if (distSqToSegment(s.x, s.y, m.startX, m.startY, m.targetX, m.targetY) <= HORN_RADIUS * HORN_RADIUS) {
        state.pendingMissiles.splice(i, 1);
        spawnExplosion(m.startX, m.startY, 25, "#ffd43b");
        clearedCount++;
      }
    }

    // 3. Destroy incoming tracer bullets
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      if (Math.hypot(s.x - p.x, s.y - p.y) <= HORN_RADIUS) {
        state.projectiles.splice(i, 1);
        spawnFireSpark(p.x, p.y);
      }
    }

    if (clearedCount > 0) {
      state.score += clearedCount * 150;
      RB.toast(`📯 Countermeasures Cleared ${clearedCount} Threat${clearedCount > 1 ? "s" : ""}!`, "good");
    }
  }

  // =========================================================================
  // 8. HAZARD LOGIC (MINES, MISSILES, TERRORISTS)
  // =========================================================================

  function spawnHazard() {
    const s = state.ship;
    const sectorData = getSectorData();
    const laneHalf = sectorData.laneHalfWidth;
    const mix = sectorData.sectorDef.mix;

    const roll = Math.random();
    let type = "mine";
    if (roll < mix.mine) type = "mine";
    else if (roll < mix.mine + mix.missile) type = "missile";
    else type = "terrorist";

    const aheadY = s.y + VISIBLE_AHEAD + rand(20, 80);

    if (type === "mine") {
      state.hazards.push({
        type: "mine",
        x: rand(-laneHalf + 18, laneHalf - 18),
        y: aheadY,
        vx: rand(-8, 8),
        vy: rand(-12, -28),
        radius: 12,
        bobPhase: Math.random() * TAU,
        spikes: randi(7, 10),
        dead: false
      });
    } else if (type === "missile") {
      // Advance Laser Lock-On Telegraph (fair warning)
      const fromSide = Math.random() < 0.65;
      let startX, startY, targetX, targetY;
      const missileSpeed = sectorData.sectorDef.missileSpeed || 250;

      if (fromSide) {
        const side = Math.random() < 0.5 ? -1 : 1;
        startX = side * (laneHalf + rand(120, 180));
        startY = s.y + rand(40, VISIBLE_AHEAD * 0.75);
        targetX = -side * (laneHalf + 120);
        targetY = startY + rand(-100, -180);
      } else {
        startX = rand(-laneHalf * 0.75, laneHalf * 0.75);
        startY = s.y + VISIBLE_AHEAD + 120;
        targetX = s.x + rand(-50, 50);
        targetY = s.y - 180;
      }

      const angle = Math.atan2(targetY - startY, targetX - startX);
      const vx = Math.cos(angle) * missileSpeed;
      const vy = Math.sin(angle) * missileSpeed;
      const warningTime = sectorData.sectorDef.missileWarningTime || 1.6;

      playSfx("lock_on");

      state.pendingMissiles.push({
        startX,
        startY,
        targetX,
        targetY,
        vx,
        vy,
        angle,
        speed: missileSpeed,
        lockTimer: warningTime,
        maxTimer: warningTime
      });
    } else if (type === "terrorist") {
      const side = Math.random() < 0.5 ? -1 : 1;
      state.hazards.push({
        type: "terrorist",
        x: side * (laneHalf + rand(30, 70)),
        y: aheadY,
        prevX: 0,
        prevY: 0,
        vx: -side * rand(50, 85),
        vy: rand(-25, -45),
        heading: 0,
        hp: 2,
        width: 14,
        length: 30,
        shootClock: rand(0.8, 1.6),
        dead: false
      });
    }
  }

  function updateHazards(dt) {
    const s = state.ship;

    // 1. Process Pending Missiles (Laser Lock-On Phase)
    for (let i = state.pendingMissiles.length - 1; i >= 0; i--) {
      const m = state.pendingMissiles[i];
      m.lockTimer -= dt;

      if (m.lockTimer <= 0) {
        state.pendingMissiles.splice(i, 1);
        playSfx("missile_launch");

        // Launch in-flight missile
        state.hazards.push({
          type: "missile",
          x: m.startX,
          y: m.startY,
          prevX: m.startX,
          prevY: m.startY,
          vx: m.vx,
          vy: m.vy,
          speed: m.speed,
          angle: m.angle,
          radius: 5,
          smokeClock: 0,
          nearMissChecked: false,
          dead: false
        });
      }
    }

    // 2. Process Active In-flight Hazards
    for (let i = state.hazards.length - 1; i >= 0; i--) {
      const h = state.hazards[i];

      if (h.type === "mine") {
        h.bobPhase += dt * 2.5;
        h.x += h.vx * dt;
        h.y += h.vy * dt;

        if (h.y < s.y - VISIBLE_BEHIND) h.dead = true;

        if (!h.dead && isInsideBoat(h.x, h.y, h.radius)) {
          detonateMine(h, false);
          takeHullDamage("Naval Contact Mine");
        }
      } else if (h.type === "missile") {
        h.prevX = h.x;
        h.prevY = h.y;
        h.x += h.vx * dt;
        h.y += h.vy * dt;

        // Smoke trail
        h.smokeClock += dt;
        if (h.smokeClock >= 0.02) {
          h.smokeClock = 0;
          spawnMissileSmoke(h.x, h.y, h.angle);
        }

        // Near Miss Detection
        if (!h.nearMissChecked && distSqToSegment(s.x, s.y, h.prevX, h.prevY, h.x, h.y) < 45 * 45) {
          h.nearMissChecked = true;
          triggerNearMiss("Anti-Ship Missile");
        }

        // Continuous Swept-Ray Collision Detection (CCD)
        if (!h.dead && checkSweptCapsuleCollision(h.prevX, h.prevY, h.x, h.y, h.radius)) {
          detonateMissile(h, false);
          takeHullDamage("Anti-Ship Missile Strike");
        }

        if (h.y < s.y - VISIBLE_BEHIND - 100 || Math.abs(h.x) > W * 0.8) {
          h.dead = true;
        }
      } else if (h.type === "terrorist") {
        const dx = s.x - h.x;
        h.vx += clamp(dx * 0.6, -100, 100) * dt;
        h.vx *= Math.max(0, 1 - 0.7 * dt);
        h.y += h.vy * dt;
        h.x += h.vx * dt;
        h.heading = Math.atan2(h.vx, h.vy);

        if (Math.random() < 0.35) {
          spawnWaterSplash(h.x, h.y - 12, 1, "rgba(255, 255, 255, 0.6)", 25);
        }

        h.shootClock -= dt;
        if (h.shootClock <= 0 && h.y > s.y + 40 && h.y < s.y + VISIBLE_AHEAD) {
          h.shootClock = rand(1.4, 2.4);
          fireTerroristBurst(h);
        }

        if (!h.dead && isInsideBoat(h.x, h.y, h.width)) {
          damageTerrorist(h, 99, false);
          takeHullDamage("Hostile Skiff Ramming");
        }

        if (h.y < s.y - VISIBLE_BEHIND) h.dead = true;
      }

      if (h.dead) {
        state.hazards.splice(i, 1);
      }
    }
  }

  function fireTerroristBurst(skiff) {
    const s = state.ship;
    const dx = s.x - skiff.x;
    const dy = s.y - skiff.y;
    const angle = Math.atan2(dy, dx) + rand(-0.10, 0.10);
    const speed = 320;

    playSfx("gunfire");

    state.projectiles.push({
      x: skiff.x,
      y: skiff.y - 10,
      prevX: skiff.x,
      prevY: skiff.y - 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 4,
      life: 2.2,
      dead: false
    });

    spawnFireSpark(skiff.x, skiff.y - 10, "#ffd43b");
  }

  function updateProjectiles(dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      p.prevX = p.x;
      p.prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      if (checkSweptCapsuleCollision(p.prevX, p.prevY, p.x, p.y, p.radius)) {
        p.dead = true;
        spawnFireSpark(p.x, p.y, "#ff3b56");
        takeHullDamage("Terrorist Machine Gun Tracer");
      }

      if (p.life <= 0 || p.dead) {
        state.projectiles.splice(i, 1);
      }
    }
  }

  function detonateMine(mine, fromCountermeasure) {
    mine.dead = true;
    spawnExplosion(mine.x, mine.y, 45, fromCountermeasure ? "#ffd43b" : "#ff3b56");
    playSfx("explosion");
  }

  function detonateMissile(missile, fromCountermeasure) {
    missile.dead = true;
    spawnExplosion(missile.x, missile.y, 55, "#ff8c1a");
    playSfx("explosion");
  }

  function damageTerrorist(skiff, dmg, fromCountermeasure) {
    skiff.hp -= dmg;
    if (skiff.hp <= 0) {
      skiff.dead = true;
      spawnExplosion(skiff.x, skiff.y, 60, "#ff5c5c");
      playSfx("explosion");
      state.score += 300 * state.multiplier;
      RB.toast("💥 Hostile Skiff Neutralized! +300", "good");
    } else {
      spawnFireSpark(skiff.x, skiff.y);
      skiff.vx += (skiff.x < state.ship.x ? -100 : 100);
    }
  }

  function triggerNearMiss(threatName) {
    const bonus = Math.round(150 * state.multiplier);
    state.score += bonus;
    state.nearMissText = `⚡ NEAR MISS! +${bonus}`;
    state.nearMissUntil = performance.now() + 1100;
    playSfx("near_miss");
  }

  // =========================================================================
  // 9. HELPFUL PICKUPS (OIL BARRELS, REPAIRS, POWERUPS)
  // =========================================================================

  function spawnPickup() {
    const s = state.ship;
    const sectorData = getSectorData();
    const laneHalf = sectorData.laneHalfWidth;

    const roll = Math.random();
    let type = "oil";
    if (roll < 0.65) type = "oil";
    else if (roll < 0.82 && s.hull < s.maxHull) type = "repair";
    else if (roll < 0.92) type = "shield";
    else type = "turbo";

    state.pickups.push({
      type,
      x: rand(-laneHalf + 24, laneHalf - 24),
      y: s.y + VISIBLE_AHEAD + rand(20, 100),
      bob: Math.random() * TAU,
      dead: false
    });
  }

  function updatePickups(dt) {
    const s = state.ship;

    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const p = state.pickups[i];
      p.bob += dt * 3;

      if (p.y < s.y - VISIBLE_BEHIND) {
        p.dead = true;
      }

      if (!p.dead && isInsideBoat(p.x, p.y, 16)) {
        p.dead = true;
        collectPickup(p);
      }

      if (p.dead) {
        state.pickups.splice(i, 1);
      }
    }
  }

  function collectPickup(p) {
    const s = state.ship;

    if (p.type === "oil") {
      state.cargoCombo++;
      state.multiplier = Math.min(5.0, 1.0 + Math.floor(state.cargoCombo / 3) * 0.5);
      const points = Math.round(250 * state.multiplier);
      state.score += points;
      spawnPickupSparkles(p.x, p.y, "#ffd43b");
      playSfx("barrel");
      RB.toast(`🛢️ Oil Cargo Loaded! +${points} (${state.multiplier.toFixed(1)}x)`, "good");
    } else if (p.type === "repair") {
      s.hull = Math.min(s.maxHull, s.hull + 1);
      state.score += 500;
      spawnPickupSparkles(p.x, p.y, "#4ade80");
      playSfx("repair");
      RB.toast("🧰 Hull Patched! +1 Integrity", "good");
    } else if (p.type === "shield") {
      s.hasShield = true;
      state.score += 400;
      spawnPickupSparkles(p.x, p.y, "#2ee0ff");
      playSfx("powerup");
      RB.toast("🛡️ Naval Deflector Online!", "good");
      updatePowerupUI();
    } else if (p.type === "turbo") {
      s.turboTimer = 12.0;
      state.score += 400;
      spawnPickupSparkles(p.x, p.y, "#ff2e88");
      playSfx("powerup");
      RB.toast("⚡ Turbo Propeller Engaged (12s)!", "good");
      updatePowerupUI();
    }

    updatePowerupUI();
  }

  // =========================================================================
  // 10. DAMAGE & GAME OVER
  // =========================================================================

  function takeHullDamage(sourceLabel) {
    const s = state.ship;
    if (s.iframe > 0) return;

    if (s.hasShield) {
      s.hasShield = false;
      s.iframe = 0.8;
      state.camShake = 0.35;
      state.screenFlash = 0.4;
      spawnExplosion(s.x, s.y, 40, "#2ee0ff");
      playSfx("hit");
      RB.toast("🫧 Deflector Shield Absorbed Impact!", "good");
      updatePowerupUI();
      return;
    }

    s.hull = Math.max(0, s.hull - 1);
    s.iframe = IFRAME_DURATION;
    state.cargoCombo = 0;
    state.multiplier = 1.0;
    state.camShake = 0.55;
    state.screenFlash = 0.6;
    state.lastCauseOfDeath = sourceLabel;

    spawnExplosion(s.x, s.y, 50, "#ff3b56");
    playSfx(s.hull <= 0 ? "explosion" : "hit");

    if (s.hull <= 0) {
      triggerGameOver();
    } else {
      RB.toast(`💥 Direct Hit from ${sourceLabel}! Hull: ${s.hull}/${s.maxHull}`, "bad");
    }
  }

  function triggerGameOver() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    if (saveSlot) saveSlot.clear();

    const finalDistance = (state.distance / NAUTICAL_MILE_UNITS).toFixed(2);
    const finalSector = getSectorData().sectorNumber;

    spawnExplosion(state.ship.x, state.ship.y, 90, "#ff3b56");
    spawnExplosion(state.ship.x + 15, state.ship.y - 20, 75, "#ff8c1a");
    spawnExplosion(state.ship.x - 15, state.ship.y + 20, 65, "#ffd43b");
    state.camShake = 0.9;
    state.screenFlash = 0.95;

    const isHigh = RB.recordScore("hormuz", state.score);
    if (isHigh) RB.toast("🏆 NEW HIGH SCORE!", "good");

    setTimeout(() => {
      showWipeoutDebrief(finalDistance, finalSector, isHigh);
    }, 1000);
  }

  function showWipeoutDebrief(finalDistance, finalSector, isHigh) {
    const mount = document.getElementById("wipeout-mount");
    if (!mount) return;

    mount.innerHTML = `
      <div class="wipeout-card">
        <div class="wipeout-card__title">🚢 VESSEL DESTROYED</div>
        <div class="wipeout-card__cause">Cause: <strong>${state.lastCauseOfDeath}</strong></div>
        <div class="wipeout-grid">
          <div class="wipeout-grid__item">
            <div class="wipeout-grid__label">Final Score</div>
            <div class="wipeout-grid__val" style="color:var(--strait-cyan)">${state.score.toLocaleString()}</div>
          </div>
          <div class="wipeout-grid__item">
            <div class="wipeout-grid__label">Distance Traveled</div>
            <div class="wipeout-grid__val">${finalDistance} NM</div>
          </div>
          <div class="wipeout-grid__item">
            <div class="wipeout-grid__label">Sector Reached</div>
            <div class="wipeout-grid__val" style="color:var(--strait-amber)">Sector ${finalSector}</div>
          </div>
          <div class="wipeout-grid__item">
            <div class="wipeout-grid__label">High Score</div>
            <div class="wipeout-grid__val" style="color:var(--strait-green)">${RB.getHighScore("hormuz").toLocaleString()}</div>
          </div>
        </div>
        ${isHigh ? '<div style="color:var(--strait-green);font-family:var(--font-mono);font-size:13px;font-weight:800;margin-bottom:14px;">🏆 NEW ALL-TIME RECORD!</div>' : ""}
        <div class="wipeout-card__actions">
          <button class="btn btn--primary" id="btn-debrief-retry" style="font-size:15px;padding:10px 24px;">⛴ Launch New Voyage</button>
          <button class="btn btn--ghost" id="btn-debrief-home" style="font-size:13px;padding:10px 16px;">All Games</button>
        </div>
      </div>
    `;

    document.getElementById("btn-debrief-retry").addEventListener("click", () => {
      mount.innerHTML = "";
      startNewGame();
    });
    document.getElementById("btn-debrief-home").addEventListener("click", () => {
      window.location.href = "../games.html";
    });
  }

  // =========================================================================
  // 11. PARTICLE & VISUAL FX SYSTEMS
  // =========================================================================

  function spawnExplosion(x, y, count = 40, baseColor = "#ff3b56") {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const spd = rand(40, 240);
      state.particles.push({
        type: "fire",
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        color: i % 3 === 0 ? "#ffd43b" : i % 3 === 1 ? "#ff8c1a" : baseColor,
        size: rand(3, 7),
        life: rand(0.4, 0.9),
        maxLife: 0.9
      });
    }
  }

  function spawnMissileSmoke(x, y, angle) {
    const opp = angle + Math.PI + rand(-0.25, 0.25);
    const spd = rand(30, 80);
    state.particles.push({
      type: "smoke",
      x,
      y,
      vx: Math.cos(opp) * spd,
      vy: Math.sin(opp) * spd,
      color: "rgba(230, 235, 245, 0.55)",
      size: rand(4, 9),
      life: rand(0.5, 0.9),
      maxLife: 0.9
    });
  }

  function spawnSmokePuff(x, y, color, size) {
    state.particles.push({
      type: "smoke",
      x,
      y,
      vx: rand(-10, 10),
      vy: rand(-20, -50),
      color,
      size,
      life: rand(0.6, 1.1),
      maxLife: 1.1
    });
  }

  function spawnFireSpark(x, y, color = "#ff8c1a") {
    state.particles.push({
      type: "spark",
      x,
      y,
      vx: rand(-30, 30),
      vy: rand(-40, 20),
      color,
      size: rand(2, 4),
      life: rand(0.3, 0.6),
      maxLife: 0.6
    });
  }

  function spawnPickupSparkles(x, y, color) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * TAU;
      const spd = rand(30, 120);
      state.particles.push({
        type: "sparkle",
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        color,
        size: rand(2, 5),
        life: rand(0.4, 0.7),
        maxLife: 0.7
      });
    }
  }

  function spawnWaterSplash(x, y, count = 6, color = "rgba(255, 255, 255, 0.6)", speed = 60) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(20, speed);
      state.particles.push({
        type: "splash",
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        color,
        size: rand(2, 4),
        life: rand(0.3, 0.6),
        maxLife: 0.6
      });
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size = Math.max(1, p.size * (1 - dt * 0.5));
    }

    for (let i = state.wakes.length - 1; i >= 0; i--) {
      const w = state.wakes[i];
      w.life -= dt;
      if (w.life <= 0) {
        state.wakes.splice(i, 1);
        continue;
      }
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.width += dt * 45;
    }

    for (let i = state.shockwaves.length - 1; i >= 0; i--) {
      const sw = state.shockwaves[i];
      sw.life -= dt;
      if (sw.life <= 0) {
        state.shockwaves.splice(i, 1);
        continue;
      }
      sw.radius += (sw.maxRadius - sw.radius) * (dt * 7.0);
    }
  }

  // =========================================================================
  // 12. PROCEDURAL RENDERING & HIGH-QUALITY VISUALS
  // =========================================================================

  function draw() {
    const sectorData = getSectorData();
    const sectorDef = sectorData.sectorDef;

    const shake = state.camShake;
    const sx = (Math.random() - 0.5) * shake * 14;
    const sy = (Math.random() - 0.5) * shake * 14;

    ctx.save();
    ctx.translate(sx, sy);

    // 1. Procedural Persian Gulf Ocean Surface
    drawOcean(sectorDef, sectorData);

    // 2. Navigational Channel Guides & Coastal Terrain
    drawCoastlinesAndLanes(sectorData);

    // 3. Distance & Milestone Markers
    drawMilestoneMarkers();

    // 4. Missile Laser Lock-On Telegraph Lines (Pre-launch Warnings)
    drawLaserTelegraphs();

    // 5. Boat Wake Ripples
    drawWakes();

    // 6. Helpful Pickups
    drawPickups();

    // 7. Hazards (Mines, In-Flight Missiles, Terrorists)
    drawHazards();

    // 8. Tracer Projectiles
    drawProjectiles();

    // 9. Player Boat
    drawShip();

    // 10. Shockwaves & Countermeasure Flare Rings
    drawShockwaves();

    // 11. Particles, Fire & Splashes
    drawParticles();

    // 12. Atmospheric Fog & Storm Effects
    drawAtmosphere(sectorDef);

    ctx.restore();

    // 13. In-Game Screen HUD (Score, Dist, Sector, Hull, Multiplier, Powerups)
    drawInGameHUD();

    // 14. Screen Damage / Lightning Flash
    if (state.screenFlash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${state.screenFlash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
      state.screenFlash = Math.max(0, state.screenFlash - 0.04);
    }

    // 15. UI Overlays (Near Miss, Sector Banners)
    drawInGameNotifications();
  }

  function drawOcean(sectorDef, sectorData) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, sectorDef.waterTop);
    grad.addColorStop(0.5, sectorDef.waterMid);
    grad.addColorStop(1, sectorDef.waterBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const time = performance.now() * 0.0015;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.lineWidth = 1.5;

    const baseCell = Math.floor(state.ship.y / 36);
    for (let i = -4; i < 26; i++) {
      const wy = (baseCell + i) * 36;
      const sp = worldToScreen(0, wy);
      if (sp.y < -30 || sp.y > H + 30) continue;

      const waveOffset = Math.sin(time + (baseCell + i) * 0.4) * 22;
      ctx.beginPath();
      ctx.moveTo(0, sp.y + waveOffset);
      ctx.bezierCurveTo(
        W * 0.33, sp.y + waveOffset - 8,
        W * 0.66, sp.y + waveOffset + 8,
        W, sp.y + waveOffset
      );
      ctx.stroke();
    }
  }

  function drawCoastlinesAndLanes(sectorData) {
    const laneHalf = sectorData.laneHalfWidth;
    const leftScreenX = worldToScreen(-laneHalf, 0).x;
    const rightScreenX = worldToScreen(laneHalf, 0).x;

    const cliffColor = "#1a1824";

    // Left Shore
    ctx.fillStyle = cliffColor;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(leftScreenX - 45, 0);
    for (let y = 0; y <= H; y += 40) {
      const wy = state.ship.y + (H * 0.65 - y);
      const jagged = Math.sin(wy * 0.015) * 18 + Math.cos(wy * 0.038) * 12;
      ctx.lineTo(leftScreenX - 45 + jagged, y);
    }
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y <= H; y += 40) {
      const wy = state.ship.y + (H * 0.65 - y);
      const jagged = Math.sin(wy * 0.015) * 18 + Math.cos(wy * 0.038) * 12;
      if (y === 0) ctx.moveTo(leftScreenX - 45 + jagged, y);
      else ctx.lineTo(leftScreenX - 45 + jagged, y);
    }
    ctx.stroke();

    // Right Shore
    ctx.fillStyle = cliffColor;
    ctx.beginPath();
    ctx.moveTo(W, 0);
    ctx.lineTo(rightScreenX + 45, 0);
    for (let y = 0; y <= H; y += 40) {
      const wy = state.ship.y + (H * 0.65 - y);
      const jagged = Math.sin(wy * 0.018 + 1.2) * 18 + Math.cos(wy * 0.042) * 12;
      ctx.lineTo(rightScreenX + 45 + jagged, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y <= H; y += 40) {
      const wy = state.ship.y + (H * 0.65 - y);
      const jagged = Math.sin(wy * 0.018 + 1.2) * 18 + Math.cos(wy * 0.042) * 12;
      if (y === 0) ctx.moveTo(rightScreenX + 45 + jagged, y);
      else ctx.lineTo(rightScreenX + 45 + jagged, y);
    }
    ctx.stroke();

    // Navigational Buoy Lane
    ctx.strokeStyle = "rgba(46, 224, 255, 0.22)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(leftScreenX, 0);
    ctx.lineTo(leftScreenX, H);
    ctx.moveTo(rightScreenX, 0);
    ctx.lineTo(rightScreenX, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawMilestoneMarkers() {
    const baseDist = Math.floor(state.ship.y / 400) * 400;
    for (let d = baseDist - 400; d < state.ship.y + VISIBLE_AHEAD; d += 400) {
      if (d <= 0) continue;
      const sp = worldToScreen(0, d);
      if (sp.y < 0 || sp.y > H) continue;

      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.fillRect(40, sp.y, W - 80, 1.5);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.font = "800 10px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${(d / NAUTICAL_MILE_UNITS).toFixed(1)} NM`, 50, sp.y - 4);
    }
  }

  function drawLaserTelegraphs() {
    const now = performance.now();
    for (const m of state.pendingMissiles) {
      const p1 = worldToScreen(m.startX, m.startY);
      const p2 = worldToScreen(m.targetX, m.targetY);

      const pulse = 0.5 + 0.5 * Math.sin(now * 0.02);
      const alpha = 0.35 + pulse * 0.45;

      // Laser Trajectory Beam
      ctx.strokeStyle = `rgba(255, 59, 86, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pulsing Warning Crosshair on Target Point
      const midPoint = worldToScreen(
        (m.startX + m.targetX) * 0.5,
        (m.startY + m.targetY) * 0.5
      );

      ctx.fillStyle = `rgba(255, 59, 86, ${alpha * 0.95})`;
      ctx.font = "800 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.shadowColor = "#ff3b56";
      ctx.shadowBlur = 8;
      ctx.fillText("⚠️ MISSILE INCOMING", midPoint.x, midPoint.y - 12);
      ctx.shadowBlur = 0;
    }
  }

  function drawWakes() {
    for (const w of state.wakes) {
      const sp = worldToScreen(w.x, w.y);
      if (sp.y < -40 || sp.y > H + 40) continue;
      const alpha = (w.life / w.maxLife) * 0.45;

      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, w.width, w.width * 0.4, w.heading, 0, TAU);
      ctx.stroke();
    }
  }

  function drawPickups() {
    for (const p of state.pickups) {
      const sp = worldToScreen(p.x, p.y);
      if (sp.y < -30 || sp.y > H + 30) continue;

      const bobY = Math.sin(p.bob) * 3;

      if (p.type === "oil") {
        ctx.fillStyle = "rgba(255, 212, 59, 0.25)";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y + bobY, 18, 0, TAU);
        ctx.fill();

        ctx.fillStyle = "#1e1b18";
        ctx.beginPath();
        ctx.roundRect(sp.x - 10, sp.y - 13 + bobY, 20, 26, 4);
        ctx.fill();
        ctx.strokeStyle = "#ffd43b";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.strokeStyle = "#ffd43b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x - 10, sp.y - 5 + bobY);
        ctx.lineTo(sp.x + 10, sp.y - 5 + bobY);
        ctx.moveTo(sp.x - 10, sp.y + 5 + bobY);
        ctx.lineTo(sp.x + 10, sp.y + 5 + bobY);
        ctx.stroke();

        ctx.fillStyle = "#ffd43b";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🛢️", sp.x, sp.y + 4 + bobY);
      } else if (p.type === "repair") {
        ctx.fillStyle = "rgba(74, 222, 128, 0.3)";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y + bobY, 20, 0, TAU);
        ctx.fill();

        ctx.fillStyle = "#0f3d20";
        ctx.beginPath();
        ctx.roundRect(sp.x - 12, sp.y - 12 + bobY, 24, 24, 5);
        ctx.fill();
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#4ade80";
        ctx.fillRect(sp.x - 3, sp.y - 8 + bobY, 6, 16);
        ctx.fillRect(sp.x - 8, sp.y - 3 + bobY, 16, 6);
      } else if (p.type === "shield") {
        ctx.fillStyle = "rgba(46, 224, 255, 0.35)";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y + bobY, 16, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#2ee0ff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🛡️", sp.x, sp.y + 5 + bobY);
      } else if (p.type === "turbo") {
        ctx.fillStyle = "rgba(255, 46, 136, 0.35)";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y + bobY, 16, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#ff2e88";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("⚡", sp.x, sp.y + 5 + bobY);
      }
    }
  }

  function drawHazards() {
    for (const h of state.hazards) {
      const sp = worldToScreen(h.x, h.y);
      if (sp.y < -50 || sp.y > H + 50) continue;

      if (h.type === "mine") {
        const bob = Math.sin(h.bobPhase) * 2.5;
        const pulse = 0.5 + 0.5 * Math.sin(h.bobPhase * 2.0);

        ctx.fillStyle = `rgba(255, 59, 86, ${0.15 + pulse * 0.15})`;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y + bob, h.radius * 2.0, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y + bob + 8);
        ctx.lineTo(sp.x, sp.y + bob + 26);
        ctx.stroke();

        ctx.strokeStyle = "#1a0b0b";
        ctx.lineWidth = 3;
        for (let i = 0; i < h.spikes; i++) {
          const a = (i / h.spikes) * TAU + h.bobPhase * 0.1;
          ctx.beginPath();
          ctx.moveTo(sp.x + Math.cos(a) * (h.radius * 0.6), sp.y + bob + Math.sin(a) * (h.radius * 0.6));
          ctx.lineTo(sp.x + Math.cos(a) * (h.radius * 1.35), sp.y + bob + Math.sin(a) * (h.radius * 1.35));
          ctx.stroke();
        }

        const mineGrad = ctx.createRadialGradient(sp.x - 3, sp.y + bob - 3, 2, sp.x, sp.y + bob, h.radius);
        mineGrad.addColorStop(0, "#5a2d2d");
        mineGrad.addColorStop(0.7, "#2b1010");
        mineGrad.addColorStop(1, "#120505");
        ctx.fillStyle = mineGrad;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y + bob, h.radius, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#ff3b56";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 59, 86, ${0.4 + pulse * 0.6})`;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y + bob, 3, 0, TAU);
        ctx.fill();
      } else if (h.type === "missile") {
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(h.angle + Math.PI / 2);

        const exhaustGrad = ctx.createLinearGradient(0, 8, 0, 32);
        exhaustGrad.addColorStop(0, "rgba(255, 212, 59, 0.95)");
        exhaustGrad.addColorStop(0.4, "rgba(255, 92, 59, 0.8)");
        exhaustGrad.addColorStop(1, "rgba(255, 59, 86, 0)");
        ctx.fillStyle = exhaustGrad;
        ctx.beginPath();
        ctx.moveTo(-5, 8);
        ctx.lineTo(0, 30 + Math.random() * 8);
        ctx.lineTo(5, 8);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#e8edf5";
        ctx.beginPath();
        ctx.roundRect(-4, -14, 8, 22, 3);
        ctx.fill();
        ctx.strokeStyle = "#1a2332";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = "#ff3b56";
        ctx.beginPath();
        ctx.moveTo(-4, -14);
        ctx.lineTo(0, -24);
        ctx.lineTo(4, -14);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#ff3b56";
        ctx.beginPath();
        ctx.moveTo(-4, 2);
        ctx.lineTo(-10, 8);
        ctx.lineTo(-4, 7);
        ctx.moveTo(4, 2);
        ctx.lineTo(10, 8);
        ctx.lineTo(4, 7);
        ctx.fill();

        ctx.restore();
      } else if (h.type === "terrorist") {
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(h.heading + Math.PI / 2);

        ctx.fillStyle = "#1e222d";
        ctx.beginPath();
        ctx.moveTo(-h.width * 0.5, h.length * 0.4);
        ctx.lineTo(h.width * 0.5, h.length * 0.4);
        ctx.lineTo(h.width * 0.45, -h.length * 0.2);
        ctx.lineTo(0, -h.length * 0.55);
        ctx.lineTo(-h.width * 0.45, -h.length * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#ff3b56";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = "#0a0c10";
        ctx.fillRect(-h.width * 0.4, h.length * 0.38, 4, 6);
        ctx.fillRect(h.width * 0.4 - 4, h.length * 0.38, 4, 6);

        ctx.fillStyle = "#e0a96d";
        ctx.beginPath();
        ctx.arc(0, -2, 3.5, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = "#8b9bb4";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -2);
        ctx.lineTo(0, -h.length * 0.6);
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  function drawProjectiles() {
    for (const p of state.projectiles) {
      const sp = worldToScreen(p.x, p.y);
      if (sp.y < 0 || sp.y > H) continue;

      ctx.fillStyle = "#ffd43b";
      ctx.shadowColor = "#ff3b56";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, p.radius, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawShip() {
    const s = state.ship;
    const sp = worldToScreen(s.x, s.y);

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(s.heading + s.roll);

    if (s.iframe > 0 && Math.floor(performance.now() / 80) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    if (s.hasShield) {
      ctx.strokeStyle = "rgba(46, 224, 255, 0.85)";
      ctx.fillStyle = "rgba(46, 224, 255, 0.15)";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "#2ee0ff";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(0, 0, SHIP_COLLISION_W * 1.5, SHIP_COLLISION_L * 1.15, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const hullGrad = ctx.createLinearGradient(-SHIP_COLLISION_W, 0, SHIP_COLLISION_W, 0);
    hullGrad.addColorStop(0, "#d94814");
    hullGrad.addColorStop(0.3, "#ff6b2b");
    hullGrad.addColorStop(0.7, "#ff6b2b");
    hullGrad.addColorStop(1, "#b3380c");

    ctx.fillStyle = hullGrad;
    ctx.beginPath();
    ctx.moveTo(-SHIP_COLLISION_W, SHIP_COLLISION_L * 0.85);
    ctx.lineTo(SHIP_COLLISION_W, SHIP_COLLISION_L * 0.85);
    ctx.lineTo(SHIP_COLLISION_W * 0.95, -SHIP_COLLISION_L * 0.6);
    ctx.lineTo(0, -SHIP_COLLISION_L * 0.95);
    ctx.lineTo(-SHIP_COLLISION_W * 0.95, -SHIP_COLLISION_L * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#080c14";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#222a36";
    ctx.beginPath();
    ctx.roundRect(-SHIP_COLLISION_W * 0.75, -SHIP_COLLISION_L * 0.5, SHIP_COLLISION_W * 1.5, SHIP_COLLISION_L * 1.1, 4);
    ctx.fill();

    ctx.strokeStyle = "#ffd43b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -SHIP_COLLISION_L * 0.45);
    ctx.lineTo(0, SHIP_COLLISION_L * 0.45);
    ctx.moveTo(-SHIP_COLLISION_W * 0.6, -SHIP_COLLISION_L * 0.1);
    ctx.lineTo(SHIP_COLLISION_W * 0.6, -SHIP_COLLISION_L * 0.1);
    ctx.moveTo(-SHIP_COLLISION_W * 0.6, SHIP_COLLISION_L * 0.2);
    ctx.lineTo(SHIP_COLLISION_W * 0.6, SHIP_COLLISION_L * 0.2);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(-SHIP_COLLISION_W * 0.65, SHIP_COLLISION_L * 0.45, SHIP_COLLISION_W * 1.3, 16, 3);
    ctx.fill();
    ctx.strokeStyle = "#101826";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#2ee0ff";
    ctx.fillRect(-SHIP_COLLISION_W * 0.45, SHIP_COLLISION_L * 0.48, SHIP_COLLISION_W * 0.9, 4);

    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.arc(SHIP_COLLISION_W * 0.8, -SHIP_COLLISION_L * 0.5, 2.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#ff3b56";
    ctx.beginPath();
    ctx.arc(-SHIP_COLLISION_W * 0.8, -SHIP_COLLISION_L * 0.5, 2.5, 0, TAU);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1.0;
  }

  function drawShockwaves() {
    for (const sw of state.shockwaves) {
      const sp = worldToScreen(sw.x, sw.y);
      const alpha = (sw.life / sw.maxLife);

      ctx.strokeStyle = `rgba(46, 224, 255, ${alpha * 0.85})`;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = "#2ee0ff";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sw.radius, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const sp = worldToScreen(p.x, p.y);
      if (sp.y < -20 || sp.y > H + 20) continue;
      const alpha = (p.life / p.maxLife);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      if (p.type === "fire" || p.type === "sparkle") {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.type === "smoke") {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, p.size * 1.4, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(sp.x - p.size * 0.5, sp.y - p.size * 0.5, p.size, p.size);
      }

      ctx.restore();
    }
  }

  function drawAtmosphere(sectorDef) {
    if (sectorDef.fog > 0) {
      ctx.fillStyle = `rgba(180, 210, 230, ${sectorDef.fog * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // =========================================================================
  // 13. IN-SCREEN TACTICAL HUD (Rendered within the gameplay screen)
  // =========================================================================

  function drawInGameHUD() {
    const s = state.ship;
    const sectorData = getSectorData();
    const sectorDef = sectorData.sectorDef;

    // Top HUD Bar Glassmorphism Backdrop
    const barH = 56;
    const grad = ctx.createLinearGradient(0, 0, 0, barH + 12);
    grad.addColorStop(0, "rgba(4, 10, 20, 0.94)");
    grad.addColorStop(0.75, "rgba(4, 10, 20, 0.82)");
    grad.addColorStop(1, "rgba(4, 10, 20, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, barH + 12);

    // Accent Hairline
    ctx.strokeStyle = "rgba(46, 224, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, barH);
    ctx.lineTo(W, barH);
    ctx.stroke();

    // 1. LEFT: SCORE & HIGH SCORE (Offset past hamburger button at x = 8..46)
    const leftX = 58;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.font = "800 9px JetBrains Mono, monospace";
    ctx.fillText("SCORE", leftX, 16);

    ctx.fillStyle = "#2ee0ff";
    ctx.font = "800 16px JetBrains Mono, monospace";
    ctx.shadowColor = "rgba(46, 224, 255, 0.6)";
    ctx.shadowBlur = 8;
    ctx.fillText(state.score.toLocaleString(), leftX, 34);
    ctx.shadowBlur = 0;

    const hiScore = RB.getHighScore("hormuz");
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "700 9px JetBrains Mono, monospace";
    ctx.fillText(`HI ${hiScore.toLocaleString()}`, leftX, 48);

    // 2. CENTER: SECTOR & DISTANCE
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd43b";
    ctx.font = "800 11px Inter, sans-serif";
    ctx.fillText(`SECTOR ${sectorData.sectorNumber}: ${sectorDef.name}`, W * 0.5, 20);

    const nmDist = (state.distance / NAUTICAL_MILE_UNITS).toFixed(1) + " NM";
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 14px JetBrains Mono, monospace";
    ctx.fillText(nmDist, W * 0.5, 38);

    // 3. RIGHT: HULL INTEGRITY & CARGO MULTIPLIER (Offset left of fs-btn at x = W-46..W-8)
    const rightX = W - 58;
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.font = "800 9px JetBrains Mono, monospace";
    ctx.fillText("HULL INTEGRITY", rightX, 16);

    // Hull Pips (Right-aligned)
    const pipW = 16;
    const pipH = 11;
    const pipGap = 4;
    const startPipX = rightX - (s.maxHull * (pipW + pipGap) - pipGap);

    for (let i = 0; i < s.maxHull; i++) {
      const px = startPipX + i * (pipW + pipGap);
      const py = 22;

      let color = "#4ade80";
      let glow = "rgba(74, 222, 128, 0.5)";

      if (i >= s.hull) {
        color = "rgba(255, 255, 255, 0.1)";
        glow = "transparent";
      } else if (s.hull === 1) {
        color = (Math.floor(performance.now() / 250) % 2 === 0) ? "#ff3b56" : "#ffd43b";
        glow = "rgba(255, 59, 86, 0.8)";
      } else if (i === s.hull - 1 && s.hull < s.maxHull) {
        color = "#ffd43b";
        glow = "rgba(255, 212, 59, 0.5)";
      }

      ctx.fillStyle = color;
      if (glow !== "transparent") {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.roundRect(px, py, pipW, pipH, 2.5);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Cargo Multiplier Tag below pips
    ctx.textAlign = "right";
    ctx.fillStyle = state.multiplier > 1.0 ? "#4ade80" : "rgba(255, 255, 255, 0.6)";
    ctx.font = "800 10px JetBrains Mono, monospace";
    ctx.fillText(`🛢️ ${state.multiplier.toFixed(1)}x CARGO`, rightX, 48);

    // 4. FLOATING ACTIVE POWERUP BADGES (Top-Right under HUD bar)
    let badgeY = 66;
    if (s.hasShield) {
      drawHUDPill(rightX, badgeY, "🛡️ DEFLECTOR ACTIVE", "#2ee0ff", "rgba(46, 224, 255, 0.18)");
      badgeY += 24;
    }
    if (s.turboTimer > 0) {
      drawHUDPill(rightX, badgeY, `⚡ TURBO ${Math.ceil(s.turboTimer)}S`, "#ff2e88", "rgba(255, 46, 136, 0.18)");
      badgeY += 24;
    }
  }

  function drawHUDPill(rightX, y, text, color, bg) {
    ctx.font = "800 10px JetBrains Mono, monospace";
    const textW = ctx.measureText(text).width;
    const pillW = textW + 16;
    const pillH = 19;
    const x = rightX - pillW;

    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, 999);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(text, x + 8, y + 13);
  }

  function drawInGameNotifications() {
    const now = performance.now();

    if (state.nearMissText && now < state.nearMissUntil) {
      const el = document.getElementById("combo-toast");
      if (el) {
        el.textContent = state.nearMissText;
        el.classList.add("is-active");
      }
    } else {
      const el = document.getElementById("combo-toast");
      if (el) el.classList.remove("is-active");
    }

    if (state.bannerText && now < state.bannerUntil) {
      const el = document.getElementById("sector-banner");
      if (el) {
        el.textContent = state.bannerText;
        el.classList.add("is-active");
      }
    } else {
      const el = document.getElementById("sector-banner");
      if (el) el.classList.remove("is-active");
    }
  }

  // =========================================================================
  // 14. GAME LOOP & STATE MANAGEMENT
  // =========================================================================

  let rafId = null;

  function loop(now) {
    if (!state.running) return;
    if (!state.lastFrameTime) state.lastFrameTime = now;
    const dt = Math.min(0.045, (now - state.lastFrameTime) / 1000);
    state.lastFrameTime = now;

    if (!state.paused && !state.gameOver) {
      readInput();
      updateShip(dt);

      const sectorData = getSectorData();

      // Sector Milestone Check
      if (sectorData.sectorNumber !== state.sector) {
        state.sector = sectorData.sectorNumber;
        state.bannerText = `SECTOR ${state.sector}: ${sectorData.sectorDef.name}`;
        state.bannerUntil = now + 2400;
        playSfx("sector");
        RB.toast(`Entered Sector ${state.sector}: ${sectorData.sectorDef.name}`, "good");
      }

      state.threat = sectorData.threat;

      // Spawning Clocks
      state.spawnClock += dt;
      const currentSpawnInterval = Math.max(0.50, sectorData.sectorDef.spawnInterval / (0.8 + state.threat * 0.2));
      if (state.spawnClock >= currentSpawnInterval) {
        state.spawnClock = 0;
        spawnHazard();
      }

      state.pickupClock += dt;
      if (state.pickupClock >= 3.2) {
        state.pickupClock = 0;
        spawnPickup();
      }

      // Storm lightning in Sectors 4 & 5
      if (sectorData.sectorDef.storm) {
        state.lightningTimer += dt;
        if (state.lightningTimer > rand(5.0, 9.0)) {
          state.lightningTimer = 0;
          state.screenFlash = 0.65;
          playNoise(0.5, 0.28, 300);
        }
      }

      // Update Systems
      updateHazards(dt);
      updateProjectiles(dt);
      updatePickups(dt);
      updateParticles(dt);
      updateEngineAudio();

      state.score += Math.round(dt * (18 + state.threat * 12) * state.multiplier);

      if (state.camShake > 0) state.camShake = Math.max(0, state.camShake - dt * 2.8);
    }

    draw();
    updatePowerupUI();
    rafId = requestAnimationFrame(loop);
  }

  function startNewGame() {
    if (saveSlot) saveSlot.clear();

    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.started = true;
    state.score = 0;
    state.distance = 0;
    state.sector = 1;
    state.threat = 1.0;
    state.multiplier = 1.0;
    state.cargoCombo = 0;
    state.lastCauseOfDeath = "Enemy Fire";

    state.ship = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      roll: 0,
      hull: HULL_MAX,
      maxHull: HULL_MAX,
      iframe: 0,
      hornCooldown: 0,
      turboTimer: 0,
      hasShield: false,
      flaresReady: true
    };

    state.hazards = [];
    state.pendingMissiles = [];
    state.projectiles = [];
    state.pickups = [];
    state.particles = [];
    state.wakes = [];
    state.shockwaves = [];
    state.spawnClock = 0;
    state.pickupClock = 0;

    const wipeoutMount = document.getElementById("wipeout-mount");
    if (wipeoutMount) wipeoutMount.innerHTML = "";

    hideOverlay();
    initAudio();
    if (audio.ctx?.state === "suspended") audio.ctx.resume();
    playSfx("sector");

    state.bannerText = "SECTOR 1: GULF APPROACH";
    state.bannerUntil = performance.now() + 2500;

    updatePowerupUI();
    canvas.focus();

    if (rafId) cancelAnimationFrame(rafId);
    state.lastFrameTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    const btn = document.getElementById("btn-pause");
    if (btn) btn.textContent = state.paused ? "Resume" : "Pause";
    if (!state.paused) {
      state.lastFrameTime = performance.now();
    }
  }

  function showOverlay(title, sub) {
    const ov = document.getElementById("overlay");
    if (!ov) return;
    document.getElementById("overlay-title").textContent = title;
    ov.classList.add("overlay--show");
  }

  function hideOverlay() {
    const ov = document.getElementById("overlay");
    if (ov) ov.classList.remove("overlay--show");
  }

  // =========================================================================
  // 15. POWERUP SIDEBAR UI BINDINGS
  // =========================================================================

  function updatePowerupUI() {
    const s = state.ship;

    const shieldItem = document.getElementById("pitem-shield");
    const shieldStat = document.getElementById("pstat-shield");
    if (shieldItem && shieldStat) {
      shieldItem.classList.toggle("strait-pitem--inactive", !s.hasShield);
      shieldStat.textContent = s.hasShield ? "ACTIVE" : "OFFLINE";
      shieldStat.style.color = s.hasShield ? "var(--strait-cyan)" : "";
    }

    const turboItem = document.getElementById("pitem-turbo");
    const turboStat = document.getElementById("pstat-turbo");
    if (turboItem && turboStat) {
      const active = s.turboTimer > 0;
      turboItem.classList.toggle("strait-pitem--inactive", !active);
      turboStat.textContent = active ? `${Math.ceil(s.turboTimer)}S` : "OFFLINE";
      turboStat.style.color = active ? "var(--strait-amber)" : "";
    }

    const flareItem = document.getElementById("pitem-flares");
    const flareStat = document.getElementById("pstat-flares");
    if (flareItem && flareStat) {
      const ready = s.hornCooldown <= 0;
      flareItem.classList.toggle("strait-pitem--inactive", !ready);
      flareStat.textContent = ready ? "READY" : "CHARGING";
      flareStat.style.color = ready ? "var(--strait-green)" : "";
    }
  }

  function bindFullscreen() {
    const fsBtn = document.getElementById("btn-fullscreen");
    const fsTarget = canvas.closest(".canvas-wrap");
    if (!fsBtn || !fsTarget) return;

    const toggle = () => {
      initAudio();
      const isMaxed = fsTarget.classList.toggle("is-maxed");
      document.body.classList.toggle("rb-game-maxed", isMaxed);
      fsBtn.textContent = isMaxed ? "✕" : "⛶";
      window.dispatchEvent(new Event("resize"));
      canvas.focus();
    };

    fsBtn.addEventListener("click", toggle);
  }

  // =========================================================================
  // 16. INITIALIZATION & PLATFORM BINDINGS
  // =========================================================================

  document.getElementById("btn-primary").addEventListener("click", startNewGame);
  document.getElementById("btn-pause").addEventListener("click", togglePause);
  document.getElementById("btn-sound").addEventListener("click", () => setSoundEnabled(!audio.enabled));
  document.getElementById("btn-restart").addEventListener("click", () => {
    showOverlay("⛴ RESTART VOYAGE?");
  });

  setupTouchControls();
  bindFullscreen();
  updateSoundButton();
  updatePowerupUI();

  // Initial render of water background and in-game HUD
  draw();
})();
