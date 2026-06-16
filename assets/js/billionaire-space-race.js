/* ============================================
   BILLIONAIRE SPACE RACE — launch & land lander
   --------------------------------------------
   You are a parody tech billionaire. Light the
   (investor) money on fire, claw your way up
   through a corridor of lawsuit drones and tax
   satellites, then set your ego-rocket down GENTLY
   on an increasingly tiny / moving platform.

   100% vanilla canvas. Uses the shared RB API
   (ads.js) for scores, rewarded-ad upgrades and
   toasts. Infinite, procedurally harder levels.
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 760
  const H = canvas.height;  // 620

  const GAME_ID = "bsr";

  // =========================================================================
  // 1. TUNING
  // =========================================================================
  const GRAVITY        = 0.055;   // downward accel (px/frame²) at level 1 — gentle
  const THRUST         = 0.125;   // accel along the nose while burning
  const ROT_SPEED      = 0.017;   // radians/frame while rotating
  const ROT_DAMP       = 0.74;    // angular drag when not steering (lower = settles faster)
  const MAX_VX         = 3.0;     // sideways speed cap — keeps drift controllable
  const MAX_VY         = 5.5;     // vertical speed cap (both directions)
  const SAFE_VY        = 3.6;     // max vertical speed for a clean touchdown
  const SAFE_VX        = 2.8;     // max sideways speed for a clean touchdown
  const SAFE_ANGLE     = 0.40;    // max tilt (radians ~23°) for a clean touchdown
  const FUEL_BURN      = 0.4;     // fuel units per frame of thrust
  const BASE_FUEL      = 260;     // starting fuel (level 1)
  const ROCKET_W       = 18;
  const ROCKET_H       = 40;

  // =========================================================================
  // 2. FLAVOR — the parody lives here
  // =========================================================================
  const TYCOONS = [
    {
      id: "musk", name: "Elon Tusk", co: "ThiccX",
      rocket: "Starshippost 9000", color: "#2ee0ff", shape: "starship", perk: "thrust",
      tagline: "Posts through the launch.",
      blurb: "Overengineered, runs on hype. +12% thrust — but it might explode on a livestream.",
    },
    {
      id: "bezos", name: "Jeff Bezotz", co: "Amazoom",
      rocket: "Blue Girth", color: "#7da7ff", shape: "capsule", perk: "pad",
      tagline: "Shaped like that on purpose.",
      blurb: "Prime-certified precision. The landing pad arrives +28px wider, every level. Same-day.",
    },
    {
      id: "zuck", name: "Zark Muckerberg", co: "Meta-stasis",
      rocket: "The Pivot v8", color: "#6bff7d", shape: "cube", perk: "autostab",
      tagline: "Legally a human pilot.",
      blurb: "The algorithm fixes your posture. Auto-stabilizers always on — the rocket self-levels.",
    },
  ];

  // Themed destinations — the mission progresses outward through the solar system.
  // grav is a multiplier on GRAVITY; move is the base pad drift speed (0 = stationary).
  const THEMES = {
    earth:    { id: "earth",    name: "EARTH",            pad: "PAD 39-EGO",              grav: 1.0,  move: 0,
                sky: ["#0a1430", "#274684"], ground: "#23311a", surf: "#3a5a2c", water: false,
                blurb: "investors are watching" },
    ocean:    { id: "ocean",    name: "PACIFIC DRONESHIP", pad: "OF COURSE I STILL TIP U", grav: 1.0, move: 0.8,
                sky: ["#0a1830", "#1d4a72"], ground: "#0a2438", surf: "#1f6f9a", water: true,
                blurb: "land on the barge, not the sea" },
    station:  { id: "station",  name: "ORBITAL STATION",  pad: "DOCK 7-EGO",              grav: 0.5,  move: 0.7,
                sky: ["#02030a", "#0a0a1f"], ground: "#161628", surf: "#3a3a64", water: false, space: true,
                blurb: "low-g, no atmosphere to save you" },
    moon:     { id: "moon",     name: "THE MOON",          pad: "TRANQUILITY-ISH",         grav: 0.35, move: 0,
                sky: ["#01010a", "#05050f"], ground: "#34343c", surf: "#74747e", water: false, space: true,
                blurb: "one small step, one giant liability" },
    mars:     { id: "mars",     name: "MARS",              pad: "OLYMPUS PAD",             grav: 0.6,  move: 0.7,
                sky: ["#160806", "#43180e"], ground: "#5a2417", surf: "#9a4326", water: false,
                blurb: "the planet of billionaire cope" },
    asteroid: { id: "asteroid", name: "ASTEROID BELT",     pad: "MINING CLAIM 0x9F",       grav: 0.18, move: 1.0,
                sky: ["#04050d", "#0d0d18"], ground: "#2e2a26", surf: "#564a3e", water: false, space: true,
                blurb: "stake a claim, dodge the rubble" },
    venus:    { id: "venus",    name: "VENUS",             pad: "HOTHOUSE PAD",            grav: 1.25, move: 0,
                sky: ["#3a1e06", "#b07a1e"], ground: "#6e4a16", surf: "#caa23a", water: false,
                blurb: "runaway greenhouse, runaway ego" },
    titan:    { id: "titan",    name: "TITAN",             pad: "METHANE MARINA",          grav: 0.4,  move: 0.8,
                sky: ["#1a1206", "#6a4a1a"], ground: "#2a2410", surf: "#b48a2e", water: true,
                blurb: "the dock floats; the methane does not forgive" },
    europa:   { id: "europa",   name: "EUROPA",            pad: "ICE SHELF 7",             grav: 0.3,  move: 0.9,
                sky: ["#06101a", "#16344e"], ground: "#8fa9bd", surf: "#dbeeff", water: false, space: true,
                blurb: "cracked ice over a hidden ocean" },
    sun:      { id: "sun",      name: "THE SUN (DON'T)",   pad: "SOLAR SHADE",             grav: 0.9,  move: 1.2,
                sky: ["#2a0a00", "#b03000"], ground: "#7a1a00", surf: "#ff7a00", water: false,
                blurb: "you cannot land on the sun. do it anyway." },
  };

  // Two levels per world, then the Sun escalates forever.
  const THEME_SEQUENCE = [
    THEMES.earth,    THEMES.earth,
    THEMES.ocean,    THEMES.ocean,
    THEMES.station,  THEMES.station,
    THEMES.moon,     THEMES.moon,
    THEMES.mars,     THEMES.mars,
    THEMES.asteroid, THEMES.asteroid,
    THEMES.venus,    THEMES.venus,
    THEMES.titan,    THEMES.titan,
    THEMES.europa,   THEMES.europa,
    THEMES.sun,
  ];

  function themeForLevel(level) {
    return THEME_SEQUENCE[Math.min(level - 1, THEME_SEQUENCE.length - 1)];
  }

  const OBSTACLE_TYPES = [
    { id: "lawsuit",  label: "⚖️", name: "Lawsuit Drone" },
    { id: "tax",      label: "🛰️", name: "Audit Satellite" },
    { id: "paparazzi",label: "📸", name: "Paparazzi Chopper" },
    { id: "tweet",    label: "🐦", name: "Boomerang Tweet" },
    { id: "yacht",    label: "🛥️", name: "Rival's Space Yacht" },
    { id: "union",    label: "🎈", name: "Union Picket Balloon" },
  ];

  const CRASH_CAPTIONS = [
    "Rapid Unscheduled Disassembly. We're calling it 'iterative.'",
    "Shareholders have questions. The rocket has shrapnel.",
    "It's not a crash, it's a 'hardware-rich learning event.'",
    "You disrupted the ground. The ground disrupted back.",
    "PR statement: 'the landing was a stretch goal.'",
    "Insurance adjuster has entered the chat.",
    "We achieved synergy with the launchpad. Violently.",
    "Bold of you to assume gravity respects net worth.",
    "Your biographer is already typing.",
    "That's going to be a redacted slide in the earnings call.",
    "The retrograde burn was more of a retrograde suggestion.",
    "Congrats, you minted the first NFT made of debris.",
  ];

  const HARD_LANDING = [
    "Touched down at Mach Lawsuit. Pad: dented. Ego: fine.",
    "That wasn't a landing, that was an arrival.",
    "Insurance denied: 'enthusiasm' is not covered.",
    "You parked it. In the structural sense.",
  ];

  const TILT_CRASH = [
    "Landed sideways. Visionary, but horizontal.",
    "The rocket is now a sculpture. A bad one.",
    "Gravity gave a TED talk about your angle.",
  ];

  const WIN_QUIPS = [
    "Flawless. The bootlicker quote-tweets are pouring in.",
    "Soft landing! Time to lay off the engineers who made it possible.",
    "Stuck the landing. Stock up 4%. Wages down 4%.",
    "Buttery. Somewhere a journalist is being threatened.",
    "Nailed it. Naming the platform after yourself. Again.",
  ];

  const choice = (a) => a[(Math.random() * a.length) | 0];

  // =========================================================================
  // 3. STATE
  // =========================================================================
  const state = {
    running: false,
    paused: false,
    started: false,
    crashed: false,
    landed: false,
    level: 1,
    score: 0,
    tycoon: TYCOONS[0],

    worldH: 1800,
    cameraY: 0,

    theme: THEMES.earth,
    surfaceY: 980,
    apogeeY: 80,
    reachedApogee: false,

    rocket: null,
    launchPad: null,
    landPad: null,
    obstacles: [],
    stars: [],
    particles: [],

    // per-level upgrade flags (granted by rewarded-ad gate)
    pendingUpgrades: { fuelBonus: 0, padBonus: 0, slowmo: false, autostab: false },
    shield: false,           // survive one crash
    bestAltitude: 0,
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;

  const keys = {};

  // =========================================================================
  // 4. LEVEL BUILDER — difficulty scales with level
  // =========================================================================
  function buildLevel(level) {
    const theme = themeForLevel(level);
    state.theme = theme;
    state.crashed = false;
    state.landed = false;
    state.reachedApogee = false;

    // Vertical mission corridor: surface at the bottom, "space" (apogee) at the top.
    // You must climb past the apogee line, THEN descend and land on the ground pad.
    const surfaceY = 980;
    const apogeeY = 80;
    state.surfaceY = surfaceY;
    state.apogeeY = apogeeY;
    state.worldH = surfaceY + 120;

    // Launch pad: on the surface, left side.
    const launchPad = { x: Math.round(W * 0.24), w: 116, y: surfaceY };
    state.launchPad = launchPad;

    // Landing pad: also at GROUND level, off to the right — shrinks and (per theme) moves.
    const padW = Math.max(46, 138 - level * 6);
    const moveSpeed = theme.move ? theme.move + level * 0.03 : 0;
    const moveRange = moveSpeed > 0 ? Math.min(70 + level * 10, W * 0.28) : 0;
    const baseX = clamp(W * 0.66, launchPad.x + padW / 2 + 80 + moveRange, W - padW / 2 - moveRange - 16);
    const phase = Math.random() * Math.PI * 2;
    const landPad = {
      baseX,
      x: baseX + Math.sin(phase) * moveRange,  // start where it actually rests (no first-frame pop)
      w: padW,
      y: surfaceY,
      moveSpeed,
      moveRange,
      phase,
      bob: theme.water ? 3 : 0,   // visual barge bob amplitude
    };
    state.landPad = landPad;

    // Apply one-shot upgrades earned at the last gate
    const startFuel = BASE_FUEL + state.pendingUpgrades.fuelBonus;
    state.levelFuel = startFuel;        // HUD denominator for this level
    landPad.w += state.pendingUpgrades.padBonus;
    state.slowmo = state.pendingUpgrades.slowmo;
    state.autostab = state.pendingUpgrades.autostab;

    // Founder perks — each billionaire flies differently
    const perk = state.tycoon && state.tycoon.perk;
    if (perk === "pad") landPad.w += 28;            // Bezotz: Prime-precision wider pad
    if (perk === "autostab") state.autostab = true; // Muckerberg: the algorithm self-levels
    state.thrustMul = perk === "thrust" ? 1.12 : 1; // Tusk: +12% thrust

    // Rocket sits on the launch pad
    state.rocket = {
      x: launchPad.x,
      y: launchPad.y - ROCKET_H / 2,
      vx: 0,
      vy: 0,
      angle: 0,
      angVel: 0,
      fuel: startFuel,
      thrusting: false,
      onPad: true,
    };

    // Consume the one-shot bonuses now that they're baked into this level
    state.pendingUpgrades.fuelBonus = 0;
    state.pendingUpgrades.padBonus = 0;
    state.pendingUpgrades.slowmo = false;
    state.pendingUpgrades.autostab = false;

    // Obstacle field in the vertical corridor between apogee (top) and surface (bottom)
    state.obstacles = [];
    const count = level === 1 ? 0 : Math.min(1 + level, 11);
    const top = apogeeY + 130;
    const bottom = surfaceY - 150;
    for (let i = 0; i < count; i++) {
      const t = OBSTACLE_TYPES[(Math.random() * OBSTACLE_TYPES.length) | 0];
      const r = 16 + Math.random() * 12;
      const y = top + (i / count) * (bottom - top) + (Math.random() - 0.5) * 40;
      const speed = (0.6 + Math.random() * 1.4) * (1 + level * 0.12) * (Math.random() < 0.5 ? 1 : -1);
      state.obstacles.push({
        type: t,
        x: 60 + Math.random() * (W - 120),
        y,
        r,
        vx: speed,
        vy: t.id === "tweet" ? (Math.random() - 0.5) * 0.8 : 0,
        wob: Math.random() * Math.PI * 2,
      });
    }

    // Starfield (parallax)
    if (state.stars.length === 0) {
      for (let i = 0; i < 140; i++) {
        state.stars.push({
          x: Math.random() * W,
          y: Math.random() * state.worldH,
          z: 0.3 + Math.random() * 0.7,
          r: Math.random() * 1.6 + 0.4,
        });
      }
    }
    state.particles = [];
    state.bestAltitude = 0;

    // Camera starts looking at the launch pad
    state.cameraY = clamp(state.rocket.y - H * 0.5, 0, state.worldH - H);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // =========================================================================
  // 5. INPUT
  // =========================================================================
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === "KeyP") pauseGame();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function wireDpad() {
    document.querySelectorAll("button[data-ctrl]").forEach((btn) => {
      const code = btn.dataset.ctrl;
      const press = (ev) => {
        ev.preventDefault();
        if (ev.pointerId != null && btn.setPointerCapture) {
          try { btn.setPointerCapture(ev.pointerId); } catch (_) {}
        }
        keys[code] = true;
        btn.setAttribute("aria-pressed", "true");
        canvas.focus?.({ preventScroll: true });
      };
      const release = (ev) => {
        if (ev) ev.preventDefault?.();
        keys[code] = false;
        btn.removeAttribute("aria-pressed");
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("lostpointercapture", release);
      btn.addEventListener("pointerleave", (ev) => {
        if (ev.pointerType === "mouse") release(ev);
      });
      btn.addEventListener("contextmenu", (ev) => ev.preventDefault());
    });
  }

  function releaseTouchControls() {
    keys.left = false;
    keys.right = false;
    keys.thrust = false;
    document.querySelectorAll("button[data-ctrl][aria-pressed='true']").forEach((btn) => {
      btn.removeAttribute("aria-pressed");
    });
  }

  window.addEventListener("blur", releaseTouchControls);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseTouchControls();
  });

  function thrustHeld() { return keys.Space || keys.ArrowUp || keys.KeyW || keys.thrust; }
  function leftHeld()   { return keys.ArrowLeft || keys.KeyA || keys.left; }
  function rightHeld()  { return keys.ArrowRight || keys.KeyD || keys.right; }

  // =========================================================================
  // 6. PHYSICS / UPDATE
  // =========================================================================
  function update() {
    if (!state.running || state.paused || state.crashed || state.landed) return;
    const r = state.rocket;
    const slow = state.slowmo ? 0.7 : 1;
    const g = GRAVITY * state.theme.grav * (1 + (state.level - 1) * 0.02) * slow;

    // Steering
    if (leftHeld())  r.angVel -= ROT_SPEED * slow;
    if (rightHeld()) r.angVel += ROT_SPEED * slow;
    if (state.autostab && !leftHeld() && !rightHeld()) {
      r.angVel -= r.angle * 0.04; // gently self-right
    }
    r.angVel *= ROT_DAMP;
    r.angle += r.angVel;

    // Thrust
    r.thrusting = false;
    if (thrustHeld() && r.fuel > 0) {
      r.thrusting = true;
      r.fuel = Math.max(0, r.fuel - FUEL_BURN);
      const tmul = state.thrustMul || 1;
      const ax = Math.sin(r.angle) * THRUST * tmul * slow;
      const ay = -Math.cos(r.angle) * THRUST * tmul * slow;
      r.vx += ax;
      r.vy += ay;
      r.onPad = false;
      spawnThrustParticles(r);
    }

    // Gravity (suppressed while resting on the launch pad)
    if (!r.onPad) r.vy += g;

    // Speed caps keep the rocket controllable instead of zippy
    r.vx = clamp(r.vx, -MAX_VX, MAX_VX);
    r.vy = clamp(r.vy, -MAX_VY, MAX_VY);

    r.x += r.vx;
    r.y += r.vy;

    // Side walls — bounce, don't kill (the void has standards)
    const half = ROCKET_W / 2 + 2;
    if (r.x < half) { r.x = half; r.vx = Math.abs(r.vx) * 0.4; }
    if (r.x > W - half) { r.x = W - half; r.vx = -Math.abs(r.vx) * 0.4; }

    // Soft ceiling above the apogee line — keeps you on-screen.
    const ceilY = state.apogeeY - 44;
    if (r.y < ceilY) { r.y = ceilY; if (r.vy < 0) r.vy *= -0.3; }

    // Reaching the apogee line "arms" the landing — you've officially been to space.
    if (!state.reachedApogee && (r.y - ROCKET_H / 2) <= state.apogeeY) {
      state.reachedApogee = true;
      RB.toast("🚀 Apogee reached! Now bring it down on the pad.", "good");
    }

    // Track best altitude for scoring
    const alt = state.surfaceY - r.y;
    if (alt > state.bestAltitude) state.bestAltitude = alt;

    // Move the landing pad (per-theme: barge / station drift)
    const lp = state.landPad;
    if (lp.moveSpeed > 0) {
      lp.phase += lp.moveSpeed * 0.016 * slow;
      lp.x = lp.baseX + Math.sin(lp.phase) * lp.moveRange;
    } else {
      lp.phase += 0.03; // keep phase advancing for barge-bob visuals
    }

    // Move obstacles
    for (const o of state.obstacles) {
      o.x += o.vx * slow;
      o.y += o.vy * slow;
      o.wob += 0.05;
      if (o.x < o.r + 8 || o.x > W - o.r - 8) o.vx *= -1;
      if (o.vy) { // tweets drift vertically a little
        if (Math.abs(o.y - (lp.y + 200)) > 260) o.vy *= -1;
      }
      // collision with rocket
      const dx = o.x - r.x;
      const dy = o.y - r.y;
      if (Math.hypot(dx, dy) < o.r + ROCKET_W * 0.55) {
        return doCrash(`A ${o.type.name} t-boned you. ${choice(CRASH_CAPTIONS)}`);
      }
    }

    // Surface / landing collision
    checkSurface();

    // Particles
    updateParticles();

    // Camera follows the rocket
    const targetCam = clamp(r.y - H * 0.5, 0, state.worldH - H);
    state.cameraY += (targetCam - state.cameraY) * 0.12;
  }

  function checkSurface() {
    const r = state.rocket;
    if (r.onPad) return;                 // still resting on the launch pad pre-liftoff
    if (r.vy < 0) return;                // moving up (e.g. just lifted off) — not a touchdown
    const feetY = r.y + ROCKET_H / 2;
    if (feetY < state.surfaceY) return;  // still airborne

    const lp = state.landPad;
    const onPadX = r.x > lp.x - lp.w / 2 && r.x < lp.x + lp.w / 2;

    if (state.reachedApogee && onPadX) {
      const upright = Math.abs(normAngle(r.angle)) <= SAFE_ANGLE;
      const gentle = Math.abs(r.vy) <= SAFE_VY && Math.abs(r.vx) <= SAFE_VX;
      if (upright && gentle) return doLand();
      if (!upright) return doCrash(choice(TILT_CRASH));
      return doCrash(choice(HARD_LANDING));
    }

    // Hit the surface somewhere it shouldn't
    if (!state.reachedApogee) {
      return doCrash("You set down without ever reaching space. The mission needs the 'space' part.");
    }
    if (state.theme.water) {
      return doCrash("Splashdown! Missed the droneship and fed the fish. 🌊");
    }
    return doCrash("Augered into the surface right next to the pad. So close, so expensive.");
  }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // =========================================================================
  // 7. PARTICLES
  // =========================================================================
  function spawnThrustParticles(r) {
    const baseAngle = r.angle + Math.PI; // exhaust points opposite the nose
    for (let i = 0; i < 2; i++) {
      const spread = (Math.random() - 0.5) * 0.5;
      const a = baseAngle + spread;
      const sp = 2 + Math.random() * 2.5;
      state.particles.push({
        x: r.x + Math.sin(baseAngle) * (ROCKET_H / 2),
        y: r.y - Math.cos(baseAngle) * (ROCKET_H / 2),
        vx: Math.sin(a) * sp + r.vx * 0.3,
        vy: -Math.cos(a) * sp + r.vy * 0.3,
        life: 1,
        size: 3 + Math.random() * 3,
        kind: "flame",
      });
    }
  }

  function spawnExplosion(x, y) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 6;
      state.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        size: 2 + Math.random() * 5,
        kind: "debris",
      });
    }
  }

  function updateParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === "debris") p.vy += 0.12;
      p.life -= p.kind === "flame" ? 0.08 : 0.02;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
  }

  // =========================================================================
  // 8. OUTCOMES
  // =========================================================================
  function doCrash(msg) {
    const r = state.rocket;
    if (state.shield) {
      state.shield = false;
      RB.toast("🛡️ Legal team voided the crash. (Shield used)", "good");
      // reset to a safe hover above the launch pad
      r.x = state.launchPad.x;
      r.y = state.launchPad.y - 220;
      r.vx = 0; r.vy = 0; r.angle = 0; r.angVel = 0;
      return;
    }
    state.crashed = true;
    state.running = false;
    spawnExplosion(r.x, r.y);
    setTimeout(() => RB.toast("💥 " + msg, "bad"), 50);
    finishRun(false, msg);
  }

  function doLand() {
    const r = state.rocket;
    const lp = state.landPad;
    state.landed = true;
    state.running = false;
    r.vx = 0; r.vy = 0; r.onPad = true;
    r.x = clamp(r.x, lp.x - lp.w / 2 + 6, lp.x + lp.w / 2 - 6);
    r.y = state.surfaceY - ROCKET_H / 2;
    r.angle = 0;

    // Scoring
    const fuelBonus = Math.round(r.fuel * 3);
    const precision = Math.max(0, lp.w / 2 - Math.abs(r.x - lp.x));
    const precisionBonus = Math.round(precision * 6);
    const levelBonus = state.level * 1000;
    const gained = levelBonus + fuelBonus + precisionBonus;
    state.score += gained;

    RB.recordScore(GAME_ID, state.score);
    showLevelComplete(gained, fuelBonus, precisionBonus);
  }

  function finishRun(won, msg) {
    const isHigh = RB.getHighScore(GAME_ID) === state.score && state.score > 0;
    if (isHigh && state.score > 0) setTimeout(() => RB.toast("🏆 NEW HIGH SCORE!", "good"), 500);
    showCrashCard(msg, isHigh);
  }

  // =========================================================================
  // 9. RENDER
  // =========================================================================
  function render() {
    const cam = state.cameraY;
    const theme = state.theme;
    // Sky gradient — theme-coloured, darker (space) up top
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.sky[0]);
    grad.addColorStop(1, theme.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Before the first launch there's nothing to render but the void
    if (!state.rocket || !state.launchPad || !state.landPad) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < state.stars.length; i++) {
        const s = state.stars[i];
        ctx.fillRect((s.x * 1.3) % W, (s.y * 0.43) % H, s.r, s.r);
      }
      return;
    }

    // Stars (denser/brighter in space themes)
    const starA = theme.space ? 0.9 : 0.6;
    for (const s of state.stars) {
      const sy = s.y - cam * s.z;
      if (sy < -2 || sy > H + 2) continue;
      ctx.globalAlpha = (0.4 + s.z * 0.5) * starA;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(s.x, sy, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    drawApogeeLine(cam);
    drawSurface(cam);      // ground/water + launch pad + landing pad
    for (const o of state.obstacles) drawObstacle(o, cam);
    drawParticles(cam);
    if (!state.crashed) drawRocket(cam);
    drawGuides(cam);
    drawAltimeter();
  }

  function drawApogeeLine(cam) {
    const y = state.apogeeY - cam;
    if (y < -20 || y > H + 20) return;
    const armed = state.reachedApogee;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = armed ? "rgba(107,255,125,0.5)" : "rgba(255,212,59,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = armed ? "#6bff7d" : "#ffd43b";
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(armed ? "✓ SPACE REACHED — NOW LAND BELOW" : "▲ APOGEE — REACH SPACE FIRST", W / 2, y - 8);
    ctx.restore();
  }

  function drawSurface(cam) {
    const theme = state.theme;
    const sy = state.surfaceY - cam;

    // ground / sea body
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, sy, W, state.worldH);
    // surface line
    if (theme.water) {
      ctx.fillStyle = theme.surf;
      ctx.fillRect(0, sy - 2, W, 8);
      // wave glints
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      const t = Date.now() / 600;
      for (let x = 0; x < W; x += 38) {
        const wy = sy + 2 + Math.sin(t + x * 0.05) * 2;
        ctx.fillRect(x + (Math.sin(t * 1.3 + x) * 6), wy, 14, 2);
      }
    } else {
      ctx.fillStyle = theme.surf;
      ctx.fillRect(0, sy, W, 5);
      // a few surface bumps / craters for texture
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      for (let x = 18; x < W; x += 90) {
        const r = 6 + (x % 5);
        ctx.beginPath(); ctx.ellipse(x + (state.level * 7 % 30), sy + 9, r, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawLaunchPad(cam);
    drawLandPad(cam);
  }

  function drawLaunchPad(cam) {
    const lp = state.launchPad;
    const y = lp.y - cam;
    ctx.fillStyle = "#2a2a32";
    ctx.fillRect(lp.x - lp.w / 2, y - 6, lp.w, 14);
    ctx.fillStyle = "#f7d924";
    for (let i = 0; i < lp.w; i += 22) {
      ctx.fillRect(lp.x - lp.w / 2 + i + 4, y - 2, 11, 4);
    }
    ctx.fillStyle = "#8e8ca2";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("LAUNCH", lp.x, y + 22);
  }

  function drawLandPad(cam) {
    const lp = state.landPad;
    const theme = state.theme;
    const bob = theme.water ? Math.sin(lp.phase * 1.6) * lp.bob : 0;
    const y = lp.y - cam + bob;
    const x0 = lp.x - lp.w / 2;
    const armed = state.reachedApogee;

    // barge hull / platform base
    if (theme.water) {
      ctx.fillStyle = "#20242e";
      ctx.fillRect(x0 - 6, y, lp.w + 12, 16);
      ctx.fillStyle = "#3a3f4c";
      ctx.fillRect(x0 - 6, y, lp.w + 12, 4);
    } else {
      // support legs/pillar down to the surface
      ctx.fillStyle = "#1c1c26";
      ctx.fillRect(lp.x - 5, y, 10, (state.surfaceY - cam) - y + 4);
    }

    // deck
    ctx.fillStyle = "#15151f";
    ctx.fillRect(x0, y - 8, lp.w, 10);
    // the big "land here" X / strip
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
    ctx.strokeStyle = armed ? `rgba(107,255,125,${0.55 + pulse * 0.45})` : "rgba(255,212,59,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, y - 6); ctx.lineTo(x0 + lp.w - 6, y - 1);
    ctx.moveTo(x0 + lp.w - 6, y - 6); ctx.lineTo(x0 + 6, y - 1);
    ctx.stroke();
    // beacons
    ctx.fillStyle = armed ? (pulse > 0.5 ? "#6bff7d" : "#1a3a1e") : "#ffd43b";
    ctx.beginPath(); ctx.arc(x0 + 5, y - 12, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x0 + lp.w - 5, y - 12, 3, 0, Math.PI * 2); ctx.fill();
    // label
    ctx.fillStyle = armed ? "#6bff7d" : "#ffd43b";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(theme.pad, lp.x, y - 18);
  }

  function drawObstacle(o, cam) {
    const y = o.y - cam;
    if (y < -40 || y > H + 40) return;
    const bob = Math.sin(o.wob) * 3;
    ctx.font = `${o.r * 1.7}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // faint hazard ring
    ctx.strokeStyle = "rgba(255,92,92,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(o.x, y + bob, o.r + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText(o.type.label, o.x, y + bob);
    ctx.textBaseline = "alphabetic";
  }

  function drawRocket(cam) {
    const r = state.rocket;
    const y = r.y - cam;
    ctx.save();
    ctx.translate(r.x, y);
    ctx.rotate(r.angle);

    // exhaust flame
    if (r.thrusting) {
      const fl = 14 + Math.random() * 16;
      const g = ctx.createLinearGradient(0, ROCKET_H / 2, 0, ROCKET_H / 2 + fl);
      g.addColorStop(0, "#fff3b0");
      g.addColorStop(0.5, "#ff8a00");
      g.addColorStop(1, "rgba(255,46,136,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-6, ROCKET_H / 2);
      ctx.lineTo(6, ROCKET_H / 2);
      ctx.lineTo(0, ROCKET_H / 2 + fl);
      ctx.closePath();
      ctx.fill();
    }

    // body — shape depends on which founder you picked
    const shape = state.tycoon.shape;
    if (shape === "capsule") drawBodyCapsule();
    else if (shape === "cube") drawBodyCube();
    else drawBodyStarship();

    // landing legs
    ctx.strokeStyle = "#9a98aa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-ROCKET_W / 2 + 2, ROCKET_H / 2 - 8); ctx.lineTo(-ROCKET_W / 2 - 4, ROCKET_H / 2);
    ctx.moveTo(ROCKET_W / 2 - 2, ROCKET_H / 2 - 8); ctx.lineTo(ROCKET_W / 2 + 4, ROCKET_H / 2);
    ctx.stroke();

    ctx.restore();
  }

  // ----- Founder-specific rocket bodies (drawn in rocket-local space) -----
  const HW = ROCKET_W / 2, HH = ROCKET_H / 2;

  function drawBodyStarship() {
    // Tusk: pointy stainless Starship parody
    ctx.fillStyle = "#e8e6f0";
    ctx.beginPath();
    ctx.moveTo(0, -HH);
    ctx.lineTo(HW, -HH + 16);
    ctx.lineTo(HW, HH - 8);
    ctx.lineTo(-HW, HH - 8);
    ctx.lineTo(-HW, -HH + 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = state.tycoon.color;
    ctx.beginPath();
    ctx.moveTo(0, -HH); ctx.lineTo(HW, -HH + 16); ctx.lineTo(-HW, -HH + 16);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#0b1030";
    ctx.beginPath(); ctx.arc(0, -2, 4, 0, Math.PI * 2); ctx.fill();
    // pink fins
    ctx.fillStyle = "#ff2e88";
    ctx.beginPath();
    ctx.moveTo(-HW, HH - 14); ctx.lineTo(-HW - 8, HH - 2); ctx.lineTo(-HW, HH - 4); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(HW, HH - 14); ctx.lineTo(HW + 8, HH - 2); ctx.lineTo(HW, HH - 4); ctx.fill();
  }

  function drawBodyCapsule() {
    // Bezotz: the, ahem, famously-shaped rounded capsule
    const cw = HW + 2;
    ctx.fillStyle = "#eceaf2";
    ctx.beginPath();
    ctx.moveTo(-cw, HH - 6);
    ctx.lineTo(-cw, -HH + cw);
    ctx.arc(0, -HH + cw, cw, Math.PI, 0);   // rounded dome nose
    ctx.lineTo(cw, HH - 6);
    ctx.closePath();
    ctx.fill();
    // colored dome cap
    ctx.fillStyle = state.tycoon.color;
    ctx.beginPath();
    ctx.arc(0, -HH + cw, cw, Math.PI, 0);
    ctx.lineTo(cw, -HH + cw + 4); ctx.lineTo(-cw, -HH + cw + 4);
    ctx.closePath(); ctx.fill();
    // window
    ctx.fillStyle = "#0b1030";
    ctx.beginPath(); ctx.arc(0, -2, 4, 0, Math.PI * 2); ctx.fill();
    // little fins
    ctx.fillStyle = "#7da7ff";
    ctx.beginPath();
    ctx.moveTo(-cw, HH - 12); ctx.lineTo(-cw - 7, HH - 2); ctx.lineTo(-cw, HH - 4); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cw, HH - 12); ctx.lineTo(cw + 7, HH - 2); ctx.lineTo(cw, HH - 4); ctx.fill();
  }

  function drawBodyCube() {
    // Muckerberg: blocky "metaverse" rocket with a VR-visor band + antenna
    ctx.fillStyle = "#d9d7e6";
    ctx.fillRect(-HW, -HH + 6, ROCKET_W, ROCKET_H - 12);
    // antenna
    ctx.strokeStyle = "#9a98aa"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -HH + 6); ctx.lineTo(0, -HH - 4); ctx.stroke();
    ctx.fillStyle = "#ff2e88";
    ctx.beginPath(); ctx.arc(0, -HH - 5, 2.5, 0, Math.PI * 2); ctx.fill();
    // VR-visor band in founder color
    ctx.fillStyle = state.tycoon.color;
    ctx.fillRect(-HW, -HH + 11, ROCKET_W, 9);
    ctx.fillStyle = "#0b1030";
    ctx.fillRect(-HW + 3, -HH + 13, ROCKET_W - 6, 4);
    // blocky fins
    ctx.fillStyle = "#6bff7d";
    ctx.fillRect(-HW - 6, HH - 12, 6, 8);
    ctx.fillRect(HW, HH - 12, 6, 8);
  }

  function drawParticles(cam) {
    for (const p of state.particles) {
      const y = p.y - cam;
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.kind === "flame") {
        ctx.fillStyle = p.life > 0.5 ? "#ffd43b" : "#ff8a00";
      } else {
        ctx.fillStyle = choice(["#ff2e88", "#ffd43b", "#e8e6f0", "#ff8a00"]);
      }
      ctx.fillRect(p.x - p.size / 2, y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawGuides() {
    const r = state.rocket;
    if (!r || state.crashed) return;
    // velocity-safety chevrons near the rocket when close to the pad
    const lp = state.landPad;
    const dy = (r.y) - lp.y;
    if (dy < 360 && dy > -40) {
      const vyOk = Math.abs(r.vy) <= SAFE_VY;
      const vxOk = Math.abs(r.vx) <= SAFE_VX;
      const upOk = Math.abs(normAngle(r.angle)) <= SAFE_ANGLE;
      const ry = r.y - state.cameraY;
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = vyOk ? "#6bff7d" : "#ff5c5c";
      ctx.fillText(`vy ${r.vy.toFixed(1)}`, r.x + 22, ry - 6);
      ctx.fillStyle = vxOk ? "#6bff7d" : "#ff5c5c";
      ctx.fillText(`vx ${r.vx.toFixed(1)}`, r.x + 22, ry + 6);
      ctx.fillStyle = upOk ? "#6bff7d" : "#ff5c5c";
      ctx.fillText(upOk ? "level" : "TILT!", r.x + 22, ry + 18);
    }
  }

  function drawAltimeter() {
    // right-edge bar: apogee at the top, surface/pad at the bottom, rocket in between
    const r = state.rocket;
    if (!r) return;
    const x = W - 14;
    const top = 16, bot = H - 16;
    const span = Math.max(1, state.surfaceY - state.apogeeY);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x, top, 4, bot - top);
    // apogee marker (top)
    ctx.fillStyle = state.reachedApogee ? "#6bff7d" : "#ffd43b";
    ctx.fillRect(x - 3, top - 1, 10, 3);
    // surface/pad marker (bottom)
    ctx.fillStyle = "#9a98aa";
    ctx.fillRect(x - 3, bot - 2, 10, 3);
    // rocket
    const rkT = clamp((r.y - state.apogeeY) / span, 0, 1);
    ctx.fillStyle = state.tycoon.color;
    ctx.beginPath();
    ctx.arc(x + 2, top + rkT * (bot - top), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // small color helpers
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function lerpColor(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  // =========================================================================
  // 10. HUD
  // =========================================================================
  function syncHud() {
    const r = state.rocket;
    setText("hud-level", state.level);
    setText("hud-score", state.score.toLocaleString());
    setText("hud-high", RB.getHighScore(GAME_ID).toLocaleString());
    if (r) {
      const pct = Math.round((r.fuel / (state.levelFuel || BASE_FUEL)) * 100);
      const fuelEl = document.getElementById("hud-fuel");
      if (fuelEl) {
        fuelEl.textContent = Math.max(0, pct) + "%";
        fuelEl.style.color = pct < 20 ? "var(--bad)" : pct < 45 ? "var(--accent-3)" : "var(--good)";
      }
    }
  }
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  // =========================================================================
  // 11. OVERLAYS / CARDS
  // =========================================================================
  function showCrashCard(msg, isHigh) {
    const mount = document.getElementById("card-mount");
    mount.innerHTML = `
      <div class="bsr-card">
        <h3 class="bsr-card__title">💥 RAPID UNSCHEDULED DISASSEMBLY</h3>
        <p class="bsr-card__msg">${msg}</p>
        <p class="bsr-card__stats">
          Reached <strong>Level ${state.level}</strong> · Score <strong>${state.score.toLocaleString()}</strong>
          ${isHigh ? '<br><span style="color:var(--accent-3)">🏆 New personal record!</span>' : ""}
        </p>
        <div class="bsr-card__actions">
          <button class="btn btn--primary" id="bsr-retry">Retry Level ${state.level}</button>
          <button class="btn btn--secondary" id="bsr-switch">Restart from Level 1</button>
          <button class="btn btn--secondary" id="bsr-share">Share the wreckage</button>
          <button class="btn btn--ghost" id="bsr-home">All games</button>
        </div>
      </div>`;
    // Retry keeps your progress — same level, same accumulated score.
    document.getElementById("bsr-retry").addEventListener("click", () => { mount.innerHTML = ""; startLevel(); });
    document.getElementById("bsr-switch").addEventListener("click", () => { if (saveSlot) saveSlot.clear(); mount.innerHTML = ""; state.level = 1; state.score = 0; startLevel(); });
    document.getElementById("bsr-home").addEventListener("click", () => { window.location.href = "../games.html"; });
    document.getElementById("bsr-share").addEventListener("click", () => shareCard(msg));
  }

  function showLevelComplete(gained, fuelBonus, precisionBonus) {
    const mount = document.getElementById("card-mount");
    const quip = choice(WIN_QUIPS);
    mount.innerHTML = `
      <div class="bsr-card bsr-card--win">
        <h3 class="bsr-card__title" style="color:var(--good)">🚀 TOUCHDOWN — LEVEL ${state.level} CLEARED</h3>
        <p class="bsr-card__msg">${quip}</p>
        <p class="bsr-card__stats">
          +${gained.toLocaleString()} pts &nbsp;(<span style="color:var(--accent-3)">level ${state.level * 1000}</span>
          · fuel ${fuelBonus} · precision ${precisionBonus})<br>
          Total score <strong>${state.score.toLocaleString()}</strong>
        </p>
        <div class="bsr-card__actions">
          <button class="btn btn--primary" id="bsr-next">Next launch →</button>
          <button class="btn btn--secondary" id="bsr-upgrade">🎁 Watch ad: pick an upgrade</button>
          <button class="btn btn--ghost" id="bsr-home2">Cash out</button>
        </div>
      </div>`;
    document.getElementById("bsr-next").addEventListener("click", () => { mount.innerHTML = ""; nextLevel(); });
    document.getElementById("bsr-upgrade").addEventListener("click", () => showUpgradeGate());
    document.getElementById("bsr-home2").addEventListener("click", () => { window.location.href = "../games.html"; });
  }

  const UPGRADES = {
    fuel:     { icon: "⛽", name: "More Investor Money", desc: "+50% fuel next launch. It's not your money anyway." },
    pad:      { icon: "📐", name: "Lobby for a Bigger Pad", desc: "+40px landing platform next level. Zoning is a suggestion." },
    shield:   { icon: "🛡️", name: "Retain a Legal Team", desc: "Survive one crash this run. They'll bury the evidence." },
    slowmo:   { icon: "🐌", name: "Bullet-Time Hubris", desc: "Slow the whole world 30% next level. For 'optics.'" },
    autostab: { icon: "🎯", name: "Auto-Stabilizers", desc: "Rocket self-rights when you're not steering. Next level." },
  };

  function showUpgradeGate() {
    const mount = document.getElementById("card-mount");
    const keysAll = Object.keys(UPGRADES);
    // pick 3 random upgrades
    const pick = keysAll.sort(() => Math.random() - 0.5).slice(0, 3);
    mount.innerHTML = `
      <div class="bsr-card bsr-gate">
        <h3 class="bsr-card__title" style="color:var(--accent-3)">🎁 PICK AN UPGRADE</h3>
        <p class="bsr-card__msg">${RB.isAdFree() ? "Pro perk: pick one free." : "Watch a short ad to claim one. (Or stay pure.)"}</p>
        <div class="bsr-gate__grid">
          ${pick.map((k) => `
            <button class="bsr-gate__opt" data-kind="${k}">
              <span class="bsr-gate__icon">${UPGRADES[k].icon}</span>
              <span class="bsr-gate__name">${UPGRADES[k].name}</span>
              <span class="bsr-gate__desc">${UPGRADES[k].desc}</span>
            </button>`).join("")}
        </div>
        <button class="bsr-gate__skip" id="bsr-skip">No thanks, just launch →</button>
      </div>`;
    mount.querySelectorAll(".bsr-gate__opt").forEach((b) => {
      b.addEventListener("click", () => claimUpgrade(b.dataset.kind));
    });
    document.getElementById("bsr-skip").addEventListener("click", () => { mount.innerHTML = ""; nextLevel(); });
  }

  function applyUpgrade(kind) {
    if (kind === "fuel") state.pendingUpgrades.fuelBonus += Math.round(BASE_FUEL * 0.5);
    else if (kind === "pad") state.pendingUpgrades.padBonus += 40;
    else if (kind === "shield") state.shield = true;
    else if (kind === "slowmo") state.pendingUpgrades.slowmo = true;
    else if (kind === "autostab") state.pendingUpgrades.autostab = true;
  }

  function claimUpgrade(kind) {
    const proceed = () => {
      applyUpgrade(kind);
      RB.toast(`✨ ${UPGRADES[kind].name} acquired!`, "good");
      document.getElementById("card-mount").innerHTML = "";
      nextLevel();
    };
    if (RB.isAdFree()) { proceed(); return; }
    RB.showRewarded().then((finished) => {
      if (finished) proceed();
      else RB.toast("Ad not finished — no upgrade", "bad");
    });
  }

  function shareCard(msg) {
    const text = `I just RUD'd my ego-rocket on Level ${state.level} of Billionaire Space Race. ${msg} Score: ${state.score.toLocaleString()}. Beat me 👉`;
    if (navigator.share) {
      navigator.share({ title: "Billionaire Space Race", text, url: location.href })
        .then(() => RB.toast("📤 Shared!", "good"))
        .catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + " " + location.href)
        .then(() => RB.toast("📋 Copied to clipboard", "good"))
        .catch(() => RB.toast("Share not available", "bad"));
    } else {
      RB.toast("Share not available on this device", "bad");
    }
  }

  // =========================================================================
  // 12. FLOW
  // =========================================================================
  function startLevel() {
    buildLevel(state.level);
    state.started = true;
    state.running = true;
    state.paused = false;

    const banner = document.getElementById("level-banner");
    if (banner) {
      banner.innerHTML = `LEVEL ${state.level} · ${state.theme.name}<br><span>${state.theme.pad} · ${state.theme.blurb}</span>`;
      banner.classList.add("level-banner--show");
      setTimeout(() => banner.classList.remove("level-banner--show"), 2400);
    }
    hideOverlay();
    syncHud();
    saveProgress();
  }

  function nextLevel() {
    state.level += 1;
    startLevel();
  }

  function hideOverlay() {
    const o = document.getElementById("overlay");
    if (o) o.classList.remove("overlay--show");
  }
  function showOverlay() {
    const o = document.getElementById("overlay");
    if (o) o.classList.add("overlay--show");
  }

  function pauseGame() {
    if (!state.started || state.crashed || state.landed) return;
    state.paused = !state.paused;
    RB.toast(state.paused ? "⏸ Paused" : "▶ Resumed", "");
  }

  function startGame() {
    if (saveSlot) saveSlot.clear();
    state.level = 1;
    state.score = 0;
    state.shield = false;
    state.pendingUpgrades = { fuelBonus: 0, padBonus: 0, slowmo: false, autostab: false };
    document.getElementById("card-mount").innerHTML = "";
    // state.tycoon was chosen on the founder-select screen
    startLevel();
  }

  function snapshot() {
    return {
      level: state.level,
      score: state.score,
      tycoonId: state.tycoon && state.tycoon.id,
      pendingUpgrades: { ...state.pendingUpgrades },
      shield: state.shield,
    };
  }

  function saveProgress() {
    if (!saveSlot || !state.started) return;
    saveSlot.save(snapshot());
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data) return;
    const tycoon = TYCOONS.find((item) => item.id === data.tycoonId) || TYCOONS[0];
    state.level = Math.max(1, Number(data.level) || 1);
    state.score = Math.max(0, Number(data.score) || 0);
    state.tycoon = tycoon;
    state.pendingUpgrades = {
      fuelBonus: Number(data.pendingUpgrades && data.pendingUpgrades.fuelBonus) || 0,
      padBonus: Number(data.pendingUpgrades && data.pendingUpgrades.padBonus) || 0,
      slowmo: Boolean(data.pendingUpgrades && data.pendingUpgrades.slowmo),
      autostab: Boolean(data.pendingUpgrades && data.pendingUpgrades.autostab),
    };
    state.shield = Boolean(data.shield);
    document.getElementById("card-mount").innerHTML = "";
    startLevel();
  }

  // Return to the founder-select screen (overlay)
  function returnToSelect() {
    state.started = false;
    state.running = false;
    state.crashed = false;
    state.landed = false;
    document.getElementById("card-mount").innerHTML = "";
    renderTycoonSelect();
    showOverlay();
    if (saveMenu) saveMenu.refresh();
  }

  // Build the 3-founder picker into the intro overlay
  function renderTycoonSelect() {
    const wrap = document.getElementById("tycoon-select");
    if (!wrap) return;
    wrap.innerHTML = TYCOONS.map((t, i) => `
      <button class="bsr-founder${state.tycoon.id === t.id ? " is-selected" : ""}" data-id="${t.id}">
        <span class="bsr-founder__rocket" style="--rk:${t.color}">${rocketGlyph(t.shape)}</span>
        <span class="bsr-founder__name">${t.name}</span>
        <span class="bsr-founder__co">${t.co} · "${t.rocket}"</span>
        <span class="bsr-founder__blurb">${t.blurb}</span>
      </button>`).join("");
    wrap.querySelectorAll(".bsr-founder").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tycoon = TYCOONS.find((t) => t.id === btn.dataset.id) || TYCOONS[0];
        wrap.querySelectorAll(".bsr-founder").forEach((b) => b.classList.toggle("is-selected", b === btn));
      });
    });
  }

  function rocketGlyph(shape) {
    if (shape === "capsule") return "🛸";
    if (shape === "cube") return "🤖";
    return "🚀";
  }

  // =========================================================================
  // 13. LOOP
  // =========================================================================
  function loop() {
    update();
    render();
    syncHud();
    requestAnimationFrame(loop);
  }

  // =========================================================================
  // 14. BOOT
  // =========================================================================
  function boot() {
    wireDpad();
    renderTycoonSelect();
    document.getElementById("btn-primary").addEventListener("click", startGame);
    document.getElementById("btn-pause").addEventListener("click", pauseGame);
    // Side "Restart" returns to founder select so you can re-pick
    document.getElementById("btn-restart").addEventListener("click", returnToSelect);
    if (saveSlot) {
      saveMenu = saveSlot.attachButtons({
        primary: document.getElementById("btn-primary"),
        scoreEl: document.getElementById("overlay-score"),
        continueLabel: "Continue launch",
        newLabel: "New mission",
        onContinue: restoreGame,
        summary: (saved) => {
          const data = saved.data || {};
          return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Level <strong>${Number(data.level || 1)}</strong> · Score <strong>${Number(data.score || 0).toLocaleString()}</strong>`;
        },
      });
      saveSlot.startAutosave(snapshot, () => state.started && !state.paused);
    }
    syncHud();
    loop();
  }

  boot();
})();
